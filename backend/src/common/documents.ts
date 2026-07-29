import { BadRequestException } from '@nestjs/common';

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
      : 'Недопустимый тип документа',
  );
}
