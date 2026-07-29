import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Классификация файла по basename (без изменения схемы — schema.prisma
 * в этой волне не трогаем). Единственный источник истины о том, ЧТО это за
 * файл — записи в БД, не каталог и не префикс имени: все загрузчики
 * (students.controller.ts, student-auth.controller.ts, programs.controller.ts)
 * кладут файлы ПЛОСКО в один каталог UPLOADS_DIR с именем randomUUID()+ext.
 *
 * ВАЖНО про приоритет: Document проверяется ПЕРВЫМ, раньше Student.photoUrl.
 * students.service.update() принимает произвольный photoUrl из PATCH без
 * валидации — менеджер мог бы выставить своему студенту
 * photoUrl='/uploads/<чужой_паспорт>.jpg' и прочитать чужой документ «как
 * фото своего студента». Матч по Document первым делает эту атаку
 * бесполезной — файл навсегда остаётся под правами студента-владельца
 * документа, а не «текущего значения photoUrl у кого угодно».
 */
export type FileRef =
  | {
      kind: 'DOCUMENT';
      studentId: string;
      docType: string;
      deletedAt: Date | null;
      mimeType: string;
      originalName: string;
      managerId: string | null;
      chinaManagerId: string | null;
    }
  | { kind: 'PROGRAM_IMAGE' }
  | { kind: 'STUDENT_PHOTO'; studentId: string; managerId: string | null; chinaManagerId: string | null }
  | null;

// TTL публичных имён (картинки программ) — анонимный трафик лендинга не
// должен бить в БД на каждый <img>. Инвалидируется явно из
// programs.service.ts (create/update/remove), плюс сам протухает за 60с
// на случай, если инвалидацию где-то забыли вызвать.
const PUBLIC_NAMES_TTL_MS = 60_000;

// Bounded-кэш для приватных файлов (документы/фото студентов). Ни
// Document.filename, ни Student.photoUrl не проиндексированы в этой волне
// (schema.prisma не трогаем) — без кэша каждый запрос = seq scan, готовый
// усилитель DoS для анонимного трафика. TTL короче публичного — права
// могут измениться (переназначение менеджера, soft-delete документа).
const PRIVATE_CACHE_TTL_MS = 5 * 60_000;
const PRIVATE_CACHE_MAX_ENTRIES = 1000;

@Injectable()
export class FileResolverService {
  constructor(private prisma: PrismaService) {}

  private publicNames: Set<string> | null = null;
  private publicNamesTs = 0;

  private privateCache = new Map<string, { ref: FileRef; ts: number }>();

  /** Зовётся из programs.service.ts после create/update/remove программы. */
  invalidatePublicCache(): void {
    this.publicNames = null;
  }

  async resolve(basename: string): Promise<FileRef> {
    // Порядок строго 1 → 2 → 3, первый матч выигрывает.
    const doc = await this.resolveDocument(basename);
    if (doc) return doc;

    if (await this.isPublicProgramImage(basename)) {
      return { kind: 'PROGRAM_IMAGE' };
    }

    const photo = await this.resolvePhoto(basename);
    if (photo) return photo;

    // «Сирота»: multer сохраняет файл на диск ДО создания записи в БД —
    // при упавшем запросе файл остаётся, но ни на что не ссылается.
    return null;
  }

  private setPrivateCache(key: string, ref: FileRef): void {
    if (this.privateCache.size >= PRIVATE_CACHE_MAX_ENTRIES) {
      // Простая защита от неограниченного роста: выкидываем самую старую
      // запись (Map сохраняет порядок вставки).
      const oldestKey = this.privateCache.keys().next().value;
      if (oldestKey !== undefined) this.privateCache.delete(oldestKey);
    }
    this.privateCache.set(key, { ref, ts: Date.now() });
  }

  private async resolveDocument(basename: string): Promise<FileRef> {
    const cacheKey = `doc:${basename}`;
    const cached = this.privateCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < PRIVATE_CACHE_TTL_MS) return cached.ref;

    const doc = await this.prisma.document.findFirst({
      where: { filename: basename },
      select: {
        studentId: true,
        type: true,
        deletedAt: true,
        mimeType: true,
        originalName: true,
        student: { select: { managerId: true, chinaManagerId: true } },
      },
    });
    const ref: FileRef = doc
      ? {
          kind: 'DOCUMENT',
          studentId: doc.studentId,
          docType: doc.type,
          deletedAt: doc.deletedAt,
          mimeType: doc.mimeType,
          originalName: doc.originalName,
          managerId: doc.student?.managerId ?? null,
          chinaManagerId: doc.student?.chinaManagerId ?? null,
        }
      : null;
    this.setPrivateCache(cacheKey, ref);
    return ref;
  }

  private async isPublicProgramImage(basename: string): Promise<boolean> {
    const now = Date.now();
    if (!this.publicNames || now - this.publicNamesTs > PUBLIC_NAMES_TTL_MS) {
      // Анониму отдаём картинку ЛЮБОЙ неудалённой программы, не только
      // published: картинка сама по себе не PII, а привязка к published
      // сделала бы поведение мигающим (сняли с публикации — картинка в уже
      // разосланных постах Telegram/кэше браузера мгновенно легла бы).
      const programs = await this.prisma.program.findMany({
        where: { deletedAt: null, imageUrl: { not: null } },
        select: { imageUrl: true },
      });
      this.publicNames = new Set(
        programs
          .map((p) => p.imageUrl)
          .filter((u): u is string => Boolean(u))
          .map((u) => path.basename(u)),
      );
      this.publicNamesTs = now;
    }
    return this.publicNames.has(basename);
  }

  private async resolvePhoto(basename: string): Promise<FileRef> {
    const cacheKey = `photo:${basename}`;
    const cached = this.privateCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < PRIVATE_CACHE_TTL_MS) return cached.ref;

    // deletedAt: null — в отличие от Document, здесь не даём privileged-доступ
    // к фото soft-deleted студента: у API GET /students/:id/findOne() тоже
    // нет режима «показать удалённого» ни для кого, включая FOUNDER/ADMIN
    // (там всегда фильтр deletedAt: null) — фото ведёт себя так же.
    const student = await this.prisma.student.findFirst({
      where: { photoUrl: `/uploads/${basename}`, deletedAt: null },
      select: { id: true, managerId: true, chinaManagerId: true },
    });
    const ref: FileRef = student
      ? { kind: 'STUDENT_PHOTO', studentId: student.id, managerId: student.managerId, chinaManagerId: student.chinaManagerId }
      : null;
    this.setPrivateCache(cacheKey, ref);
    return ref;
  }
}
