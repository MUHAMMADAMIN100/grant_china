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
