import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Единый справочник обязательных типов документов студента.
 * Используется в applications.service (гейт DOCS_SUBMITTED) и при необходимости
 * в других местах. Совпадает с frontend-crm/src/common/documents.ts и
 * frontend-landing/src/documents.ts.
 */
export interface DocumentTypeDef {
  type: string;
  label: string;
}

export const REQUIRED_DOCUMENT_TYPES: DocumentTypeDef[] = [
  { type: 'PHOTO', label: 'Фото 3/4' },
  { type: 'PASSPORT', label: 'Загран паспорт' },
  { type: 'BANK', label: 'Справка с банка' },
  { type: 'MEDICAL', label: 'Мед.справка' },
  { type: 'NO_CRIMINAL', label: 'Справка о несудимости' },
  { type: 'STUDY_PLAN', label: 'Study Plan (Мотивационное письмо)' },
  { type: 'CERTIFICATE', label: 'Certificate' },
  { type: 'PARENTS_PASSPORT', label: 'Паспорт родителей' },
  { type: 'DIPLOMA', label: 'Аттестат' },
  { type: 'RECOMMENDATION', label: 'Рекомендательное письмо' },
  // 12.08.2026 — приглашение из университета. Загружает менеджер (студент его
  // не готовит, а получает), но студенту оно ДОСТУПНО на скачивание: с этим
  // документом он идёт в посольство за визой. Поэтому в
  // STUDENT_RESTRICTED_DOC_TYPES (common/access.ts) НЕ добавлено.
  { type: 'INVITATION', label: 'Приглашение из университета' },
];

/**
 * Белый список типов для «обычной» загрузки документа студента —
 * POST /students/:id/documents (CRM) и POST /student-auth/documents
 * (кабинет студента). Обязательные типы студента + 'OTHER' для всего
 * остального. 'RECEIPT' сюда СОЗНАТЕЛЬНО не входит (Проблема 10 аудита
 * волны 1): без белого списка тело запроса принимало произвольную строку
 * `type`, и через эти два эндпоинта можно было создать Document{type:
 * 'RECEIPT', paymentId: null} — «висячий» чек в обход payments/ (create/
 * addReceipt), невидимый в UI и путающий инварианты removeReceipt()/
 * hasLiveReceipt(). Чек создаётся только внутри payments.service.ts.
 */
const UPLOADABLE_DOCUMENT_TYPES = new Set<string>([...REQUIRED_DOCUMENT_TYPES.map((d) => d.type), 'OTHER']);

/** Бросает 400, если `type` не входит в белый список загружаемых документов студента. */
export function assertUploadableDocumentType(type: string): void {
  if (UPLOADABLE_DOCUMENT_TYPES.has(type)) return;
  throw new BadRequestException(
    type === 'RECEIPT'
      ? 'Чек платежа загружается через раздел Финансы, а не как обычный документ студента'
      : type === 'TICKET'
        ? 'Файл билета загружается через раздел Билеты, а не как обычный документ студента'
        : 'Недопустимый тип документа',
  );
}

/**
 * Типы Document, которыми управляют СВОИ разделы, а не общий чек-лист
 * документов студента: чек платежа (payments/) и файл билета (tickets/).
 * Используется в select'ах, чтобы такие файлы не попадали ни в чек-лист CRM,
 * ни в счётчик/ZIP-архив, ни в личный кабинет студента.
 *
 * Они остаются обычными Document с полем studentId — и именно поэтому
 * бесплатно получают защиту /uploads (files/file-resolver.service.ts).
 */
export const MANAGED_DOCUMENT_TYPES: string[] = ['RECEIPT', 'TICKET'];

/**
 * Бросает 403, если документ управляется отдельным разделом. Общие эндпоинты
 * удаления (students/, student-auth/) обязаны звать эту функцию: иначе через
 * них можно снести доказательство оплаты или маршрутную квитанцию в обход
 * гейтов профильного модуля (Проблемы 1/2 аудита волны 1 — ровно этот сюжет
 * уже случался с чеками).
 */
export function assertNotManagedDocument(doc: { type: string; paymentId?: string | null; ticketId?: string | null }): void {
  if (doc.type === 'RECEIPT' || doc.paymentId) {
    throw new ForbiddenException('Чек платежа удаляется только через раздел Финансы');
  }
  if (doc.type === 'TICKET' || doc.ticketId) {
    throw new ForbiddenException('Файл билета удаляется только через раздел Билеты');
  }
}
