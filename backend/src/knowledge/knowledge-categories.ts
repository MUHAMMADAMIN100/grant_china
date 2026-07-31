/**
 * ТЗ 6.1 — разделы базы знаний. String в БД (KnowledgeArticle.category), а не
 * enum: набор регламентов будет расти вместе с CRM, и добавление раздела не
 * должно требовать ALTER TYPE на живой колонке (тот же приём, что у
 * Application.source и Document.type).
 *
 * Единственный источник истины по значениям — этот файл. Валидация
 * @IsIn(KNOWLEDGE_CATEGORY_VALUES) стоит в DTO на записи.
 */
export interface KnowledgeCategoryOption {
  value: string;
  label: string;
}

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategoryOption[] = [
  { value: 'GENERAL', label: 'Общее' },
  { value: 'LEADS', label: 'Заявки и консультации' },
  { value: 'STUDENTS', label: 'Студенты и документы' },
  { value: 'FINANCE', label: 'Финансы и платежи' },
  { value: 'CONTRACTS', label: 'Договоры' },
  { value: 'GRANTS', label: 'Гранты' },
  { value: 'TICKETS', label: 'Билеты и перелёты' },
  { value: 'PAYROLL', label: 'KPI и зарплата' },
  { value: 'RULES', label: 'Регламенты компании' },
] as const;

export const KNOWLEDGE_CATEGORY_VALUES: readonly string[] = KNOWLEDGE_CATEGORIES.map((c) => c.value);

export const KNOWLEDGE_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  KNOWLEDGE_CATEGORIES.map((c) => [c.value, c.label]),
);
