import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';

/** 507 Insufficient Storage — в enum HttpStatus этой версии Nest его нет. */
const INSUFFICIENT_STORAGE = 507;
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * 07.09.2026 — ошибки диска отдаём людям по-русски, а не «Internal server error».
 *
 * Три дня на боевом сервере не записывался ни один файл, и каждый чек, билет
 * и документ падал с безликим 500. Сотрудники решили, что «сломались оплаты»,
 * хотя платёж без чека проходил. Причина (диск) в ответе не появлялась нигде.
 *
 * Фильтр перехватывает ошибки файловой системы, которые multer/fs бросают при
 * записи в каталог загрузок, и отвечает 507 Insufficient Storage с текстом,
 * по которому ясно, кому звонить. Всё остальное — как раньше, в
 * BaseExceptionFilter. Код ошибки пишется в лог целиком: по нему видно,
 * диск полон (ENOSPC), смонтирован только на чтение (EROFS) или нет прав.
 */
const DISK_ERRORS: Record<string, string> = {
  ENOSPC: 'На сервере закончилось место на диске — файл не сохранён. Сообщите руководителю: нужно освободить или увеличить диск.',
  EROFS: 'Диск сервера временно доступен только для чтения — файл не сохранён. Сообщите руководителю.',
  EDQUOT: 'Исчерпана дисковая квота сервера — файл не сохранён. Сообщите руководителю.',
  EACCES: 'Сервер не может записать файл в каталог загрузок (нет прав). Сообщите руководителю.',
  EPERM: 'Сервер не может записать файл в каталог загрузок (нет прав). Сообщите руководителю.',
  ENOENT: 'На сервере нет каталога для загрузок — файл не сохранён. Сообщите руководителю.',
  EMFILE: 'Сервер перегружен файловыми операциями — попробуйте ещё раз через минуту.',
};

@Catch()
export class StorageErrorFilter extends BaseExceptionFilter {
  private readonly log = new Logger('StorageErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const code = (exception as NodeJS.ErrnoException | undefined)?.code;
    if (!(exception instanceof HttpException) && code && DISK_ERRORS[code]) {
      const err = exception as NodeJS.ErrnoException;
      const req = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      this.log.error(`Диск: ${code} при ${req?.method} ${req?.url} — ${err.message}${err.path ? ` (${err.path})` : ''}`);
      return super.catch(
        new HttpException(
          { statusCode: INSUFFICIENT_STORAGE, message: DISK_ERRORS[code], error: 'Insufficient Storage', code },
          INSUFFICIENT_STORAGE,
        ),
        host,
      );
    }
    return super.catch(exception, host);
  }
}
