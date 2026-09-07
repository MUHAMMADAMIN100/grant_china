import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Тот же корень, что у multer diskStorage во всех контроллерах и у раздачи /uploads. */
export const UPLOADS_ROOT = path.resolve(process.cwd(), process.env.UPLOADS_DIR || './uploads');

export interface StorageHealth {
  path: string;
  /** Байты. null — ОС не отдала statfs (старый Node или экзотическая ФС). */
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  /** 0..100. null — как выше. */
  freePercent: number | null;
  /** Реальная проба записи в каталог загрузок — единственный надёжный ответ на «можно ли сейчас загрузить файл». */
  writable: boolean;
  /** Код ошибки ОС при неудачной пробе: ENOSPC (диск полон), EROFS (только чтение), EACCES/EPERM (нет прав), ENOENT (каталога нет). */
  writeError: string | null;
  /** Сколько файлов лежит в каталоге и сколько они весят. */
  filesCount: number;
  filesBytes: number;
  checkedAt: string;
}

export interface OrphanFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface OrphanScan {
  root: string;
  scannedAt: string;
  /** Файлов в каталоге всего. */
  filesCount: number;
  filesBytes: number;
  /** На которые ссылается хоть одна строка БД — включая soft-deleted (они восстановимы, файл им нужен). */
  referencedCount: number;
  referencedBytes: number;
  /** Ни одной ссылки и старше суток. */
  orphans: OrphanFile[];
  orphansBytes: number;
  /** Ни одной ссылки, но моложе суток — возможно, загрузка ещё идёт; в кандидаты не входят. */
  recentUnreferenced: number;
}

/** Файл моложе этого срока сиротой не считаем: запись в БД может появиться через секунду после записи на диск. */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 07.09.2026 — контроль диска загрузок.
 *
 * Появился после трёх дней, когда на боевом сервере не записывался ни один
 * файл (билеты, чеки, документы, фото), а пользователи видели «Internal server
 * error» и не понимали, что делать. Причина была не в коде — в диске, — но
 * система молчала: ни ошибки по-русски, ни цифры свободного места, ни
 * предупреждения заранее. Этот сервис закрывает все три дыры:
 *  - health(): свободное место + РЕАЛЬНАЯ проба записи (statfs может врать
 *    про read-only том, проба — нет);
 *  - scanOrphans()/purgeOrphans(): файлы, на которые не ссылается ни одна
 *    строка БД (отказанные загрузки, заменённые версии) — единственное, что
 *    можно удалять с диска, не нарушая правило «данные не удаляем»;
 *  - StorageCheckJob раз в час дёргает health() и предупреждает руководство.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private prisma: PrismaService) {}

  async health(): Promise<StorageHealth> {
    let totalBytes: number | null = null;
    let freeBytes: number | null = null;
    try {
      // fs.promises.statfs — Node ≥ 18.15. На более старом рантайме просто
      // не будет цифр, но проба записи ниже всё равно ответит на главный вопрос.
      const statfs = (fs.promises as unknown as { statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }> }).statfs;
      if (statfs) {
        const s = await statfs(UPLOADS_ROOT);
        totalBytes = s.bsize * s.blocks;
        freeBytes = s.bsize * s.bavail;
      }
    } catch (err) {
      this.logger.warn(`statfs(${UPLOADS_ROOT}) не удался: ${(err as Error).message}`);
    }

    let writable = false;
    let writeError: string | null = null;
    const probe = path.join(UPLOADS_ROOT, `.probe-${randomUUID()}`);
    try {
      await fs.promises.mkdir(UPLOADS_ROOT, { recursive: true });
      await fs.promises.writeFile(probe, 'ok');
      await fs.promises.unlink(probe);
      writable = true;
    } catch (err) {
      writeError = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      await fs.promises.unlink(probe).catch(() => undefined);
    }

    const { count, bytes } = await this.dirStats();
    return {
      path: UPLOADS_ROOT,
      totalBytes,
      freeBytes,
      usedBytes: totalBytes !== null && freeBytes !== null ? totalBytes - freeBytes : null,
      freePercent: totalBytes && freeBytes !== null ? Math.round((freeBytes / totalBytes) * 1000) / 10 : null,
      writable,
      writeError,
      filesCount: count,
      filesBytes: bytes,
      checkedAt: new Date().toISOString(),
    };
  }

  private async listFiles(): Promise<Array<{ name: string; size: number; mtimeMs: number }>> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(UPLOADS_ROOT, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: Array<{ name: string; size: number; mtimeMs: number }> = [];
    for (const e of entries) {
      // Каталог плоский; вложенные папки и служебные dot-файлы не трогаем.
      if (!e.isFile() || e.name.startsWith('.')) continue;
      try {
        const st = await fs.promises.stat(path.join(UPLOADS_ROOT, e.name));
        out.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* файл исчез между readdir и stat */
      }
    }
    return out;
  }

  private async dirStats(): Promise<{ count: number; bytes: number }> {
    const files = await this.listFiles();
    return { count: files.length, bytes: files.reduce((s, f) => s + f.size, 0) };
  }

  /**
   * Все имена файлов, на которые ссылается БД. Soft-deleted строки ВКЛЮЧЕНЫ
   * намеренно: удалённый документ восстановим, и файл ему для этого нужен.
   * Источники — каждое поле схемы, где лежит путь в /uploads.
   */
  private async referencedNames(): Promise<Set<string>> {
    const base = (u: string | null | undefined): string | null => {
      if (!u) return null;
      const clean = u.split('?')[0].split('#')[0];
      const name = clean.substring(clean.lastIndexOf('/') + 1);
      return name || null;
    };
    const [docs, students, programs, calls] = await Promise.all([
      this.prisma.document.findMany({ select: { filename: true, url: true } }),
      this.prisma.student.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } }),
      this.prisma.program.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
      this.prisma.call.findMany({ where: { recordingUrl: { not: null } }, select: { recordingUrl: true } }).catch(() => [] as Array<{ recordingUrl: string | null }>),
    ]);
    const set = new Set<string>();
    for (const d of docs) {
      if (d.filename) set.add(d.filename);
      const b = base(d.url);
      if (b) set.add(b);
    }
    for (const s of students) { const b = base(s.photoUrl); if (b) set.add(b); }
    for (const p of programs) { const b = base(p.imageUrl); if (b) set.add(b); }
    for (const c of calls) { const b = base(c.recordingUrl); if (b) set.add(b); }
    return set;
  }

  async scanOrphans(): Promise<OrphanScan> {
    const [files, referenced] = await Promise.all([this.listFiles(), this.referencedNames()]);
    const now = Date.now();
    const orphans: OrphanFile[] = [];
    let referencedCount = 0;
    let referencedBytes = 0;
    let recentUnreferenced = 0;
    for (const f of files) {
      if (referenced.has(f.name)) {
        referencedCount += 1;
        referencedBytes += f.size;
      } else if (now - f.mtimeMs < ORPHAN_MIN_AGE_MS) {
        recentUnreferenced += 1;
      } else {
        orphans.push({ name: f.name, size: f.size, modifiedAt: new Date(f.mtimeMs).toISOString() });
      }
    }
    orphans.sort((a, b) => b.size - a.size);
    return {
      root: UPLOADS_ROOT,
      scannedAt: new Date().toISOString(),
      filesCount: files.length,
      filesBytes: files.reduce((s, f) => s + f.size, 0),
      referencedCount,
      referencedBytes,
      orphans,
      orphansBytes: orphans.reduce((s, f) => s + f.size, 0),
      recentUnreferenced,
    };
  }

  /**
   * Удаляет ТОЛЬКО то, что прямо сейчас проходит проверку сиротства заново —
   * список из UI мог устареть: пока Основатель читал отчёт, файл могли
   * привязать к документу. Возвращает, что удалено и сколько освобождено.
   */
  async purgeOrphans(names: string[]): Promise<{ deleted: string[]; freedBytes: number; skipped: string[] }> {
    if (!Array.isArray(names) || names.length === 0) throw new BadRequestException('Список файлов пуст');
    if (names.length > 5000) throw new BadRequestException('За один раз — не больше 5000 файлов');
    const fresh = await this.scanOrphans();
    const allowed = new Map(fresh.orphans.map((o) => [o.name, o.size]));
    const deleted: string[] = [];
    const skipped: string[] = [];
    let freedBytes = 0;
    for (const raw of names) {
      const name = path.basename(String(raw));
      // Только имя файла из плоского каталога — никаких путей и подкаталогов.
      if (name !== raw || name.startsWith('.') || !allowed.has(name)) {
        skipped.push(String(raw));
        continue;
      }
      try {
        await fs.promises.unlink(path.join(UPLOADS_ROOT, name));
        deleted.push(name);
        freedBytes += allowed.get(name) ?? 0;
      } catch (err) {
        this.logger.warn(`Не удалось удалить сироту ${name}: ${(err as Error).message}`);
        skipped.push(name);
      }
    }
    this.logger.log(`Уборка сирот: удалено ${deleted.length}, освобождено ${(freedBytes / 1048576).toFixed(1)} МБ, пропущено ${skipped.length}`);
    return { deleted, freedBytes, skipped };
  }
}
