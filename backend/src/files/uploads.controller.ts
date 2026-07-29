import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { FileResolverService, FileRef } from './file-resolver.service';
import { UploadsAccessService } from './uploads-access.service';
import { SessionResolverService } from '../auth/session-resolver.service';

const UPLOADS_ROOT = path.resolve(process.cwd(), process.env.UPLOADS_DIR || './uploads');

// Preview-белый список: эти типы можно открывать inline (в новой вкладке /
// <img> / <video>), всё остальное — принудительное скачивание. Раньше
// serve-static отдавал файл с mimetype ПО РАСШИРЕНИЮ ФАЙЛА НА ДИСКЕ — файл
// с mimetype=text/plain и именем evil.html (fileFilter в students.controller.ts
// пропускает файл, если совпадает mimetype ИЛИ расширение) сохранялся как
// <uuid>.html и отдавался как text/html на origin CRM = stored XSS. Теперь
// Content-Type всегда берётся из БД (Document.mimeType), не из расширения.
const PREVIEW_MIME_RE = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|video\/|text\/plain)/i;

// decodeURIComponent → basename → эта маска → отказ, если имя начинается с
// точки. Все загрузчики кладут файлы как randomUUID()+расширение — маска
// уже, чем нужно, специально (никаких пробелов/юникода в валидных именах).
const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,255}$/;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

/**
 * Отдаёт файлы из /uploads с проверкой прав. Раньше это делал
 * ServeStaticModule (express static middleware) БЕЗ АВТОРИЗАЦИИ — весь
 * каталог, включая сканы паспортов и справки BANK/MEDICAL, был доступен
 * анониму по прямой ссылке (Проблема E аудита). ServeStaticModule убран из
 * app.module.ts — если его вернуть «на время», он снова перехватит запрос
 * раньше этого контроллера (express-middleware работает до Nest-роутинга).
 *
 * БЕЗ глобального guard намеренно: анониму должны быть доступны картинки
 * программ (публичный каталог на лендинге). Идентичность резолвится
 * «мягко» через SessionResolverService (не бросает 401).
 */
@SkipThrottle()
@Controller('uploads')
export class UploadsController {
  constructor(
    private fileResolver: FileResolverService,
    private access: UploadsAccessService,
    private session: SessionResolverService,
  ) {}

  @Get(':filename')
  async serve(@Param('filename') filenameRaw: string, @Req() req: Request, @Res() res: Response) {
    const absPath = this.resolveSafePath(filenameRaw);
    if (!absPath) throw new NotFoundException();
    const basename = path.basename(absPath);

    const [ref, identity] = await Promise.all([
      this.fileResolver.resolve(basename),
      this.session.resolve((req.cookies || {}) as Record<string, string | undefined>),
    ]);

    const decision = this.access.decide(identity, ref);
    // 404 (не 401/403) на любой отказ — та же логика «не быть оракулом
    // существования», что и в students.service.findOne() Волны 0.
    if (decision !== 'allow' || !ref) {
      throw new NotFoundException();
    }

    if (!fs.existsSync(absPath)) throw new NotFoundException();

    if (ref.kind === 'PROGRAM_IMAGE') {
      // Имя = randomUUID+ext, файл неизменяем — можно кэшировать вечно.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // Приватный файл НИКОГДА не должен осесть в общем HTTP/CDN-кэше —
      // публичные и приватные файлы живут на одном пути /uploads/*, прокси
      // не может их различить. Vary: Cookie — чтобы промежуточный кэш (если
      // такой всё же появится) не спутал ответы разных пользователей.
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Cookie');
    }

    const { contentType, disposition, downloadName } = this.buildContentHeaders(ref, basename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

    // res.sendFile (Express → пакет `send`) сам обрабатывает Range/206
    // Partial Content/If-Range/If-Modified-Since/ETag — нужно для перемотки
    // видео-презентаций студентов. cacheControl:false — чтобы `send` не
    // переписал уже выставленный нами выше Cache-Control своим default'ом.
    res.sendFile(absPath, { cacheControl: false, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).end();
      }
    });
  }

  private resolveSafePath(filenameRaw: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(filenameRaw);
    } catch {
      return null;
    }
    const base = path.basename(decoded);
    if (!SAFE_NAME_RE.test(base) || base.startsWith('.')) return null;
    const abs = path.resolve(UPLOADS_ROOT, base);
    // Страховка от выхода за пределы каталога (path traversal) — после
    // basename() практически невозможно, но проверяем явно.
    if (abs !== path.join(UPLOADS_ROOT, base)) return null;
    return abs;
  }

  private buildContentHeaders(
    ref: NonNullable<FileRef>,
    basename: string,
  ): { contentType: string; disposition: 'inline' | 'attachment'; downloadName: string } {
    if (ref.kind === 'PROGRAM_IMAGE') {
      const ext = path.extname(basename).toLowerCase();
      return {
        contentType: IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream',
        disposition: 'inline',
        downloadName: basename,
      };
    }
    if (ref.kind === 'DOCUMENT') {
      const contentType = ref.mimeType || 'application/octet-stream';
      return {
        contentType,
        disposition: PREVIEW_MIME_RE.test(contentType) ? 'inline' : 'attachment',
        downloadName: ref.originalName || basename,
      };
    }
    // STUDENT_PHOTO — Student не хранит mimeType, но uploadPhoto (students
    // .controller.ts) принимает только image/* в fileFilter, так что
    // расширение файла надёжно отражает тип картинки.
    const ext = path.extname(basename).toLowerCase();
    return {
      contentType: IMAGE_MIME_BY_EXT[ext] || 'image/jpeg',
      disposition: 'inline',
      downloadName: basename,
    };
  }
}
