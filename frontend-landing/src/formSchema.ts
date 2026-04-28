export type FieldKind = 'text' | 'date' | 'email' | 'tel' | 'number' | 'textarea' | 'radio' | 'year' | 'select';

export interface FieldDef {
  key: string;
  label: string;
  labelEn?: string;
  kind?: FieldKind;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  /** не учитывается в подсчёте «N из M полей» */
  optional?: boolean;
  /** разрешена только латиница / цифры — для текстовых полей анкеты */
  latin?: boolean;
  /** для number-полей: ограничение значения */
  min?: number;
  max?: number;
}

export interface SectionDef {
  key: string;
  icon: string;
  title: string;
  titleEn?: string;
  fields?: FieldDef[];
  table?: {
    columns: FieldDef[];
    defaultRows?: number;
    rowLabels?: string[]; // названия строк для education (Primary school, Secondary school, ...)
    fixedRows?: boolean; // если true — нельзя добавлять/удалять строки
    minRows?: number;
  };
}

export const FORM_SECTIONS: SectionDef[] = [
  {
    key: 'personal',
    icon: 'person',
    title: 'Личные данные',
    titleEn: 'Personal Information',
    fields: [
      { key: 'surname', label: 'Фамилия (как в паспорте)', labelEn: 'Surname', latin: true },
      { key: 'givenName', label: 'Имя (как в паспорте)', labelEn: 'Given name', latin: true },
      { key: 'birthDate', label: 'Дата рождения', labelEn: 'Date of Birth', kind: 'date' },
      { key: 'birthPlace', label: 'Место рождения', labelEn: 'Place of Birth', latin: true },
      { key: 'nationality', label: 'Национальность', labelEn: 'Nationality', latin: true },
      { key: 'currentCountry', label: 'Текущая страна / город', labelEn: 'Present Country/City', latin: true },
      { key: 'passportNumber', label: 'Номер паспорта', labelEn: 'Passport No.', latin: true },
      { key: 'passportExpiry', label: 'Срок действия паспорта', labelEn: 'Passport Expiration', kind: 'date' },
      {
        key: 'gender',
        label: 'Пол',
        labelEn: 'Gender',
        kind: 'radio',
        options: [
          { value: 'MALE', label: 'Мужской' },
          { value: 'FEMALE', label: 'Женский' },
        ],
      },
      { key: 'religion', label: 'Религия', labelEn: 'Religion', latin: true, optional: true },
      { key: 'nativeLanguage', label: 'Родной язык', labelEn: 'Native Language', latin: true },
      { key: 'officialLanguage', label: 'Официальный язык', labelEn: 'Official Language', latin: true },
      {
        key: 'maritalStatus',
        label: 'Семейное положение',
        labelEn: 'Marital Status',
        kind: 'radio',
        options: [
          { value: 'SINGLE', label: 'Холост / не замужем' },
          { value: 'MARRIED', label: 'В браке' },
          { value: 'OTHER', label: 'Другое' },
        ],
      },
      {
        key: 'educationLevel',
        label: 'Высший уровень образования',
        labelEn: 'Highest Education Level',
        kind: 'radio',
        options: [
          { value: 'HIGH_SCHOOL', label: 'Средняя школа' },
          { value: 'BACHELOR', label: 'Бакалавр' },
          { value: 'MASTER', label: 'Магистр' },
          { value: 'PHD', label: 'PhD' },
        ],
      },
      {
        key: 'inChina',
        label: 'Сейчас находитесь в Китае?',
        labelEn: 'Are you currently in China?',
        kind: 'radio',
        options: [
          { value: 'YES', label: 'Да' },
          { value: 'NO', label: 'Нет' },
        ],
      },
    ],
  },
  {
    key: 'address',
    icon: 'home',
    title: 'Адрес постоянного проживания',
    titleEn: 'Permanent Address',
    fields: [
      { key: 'home', label: 'Домашний адрес', labelEn: 'Home Address', kind: 'textarea', placeholder: 'Страна, город, улица, дом', latin: true },
      { key: 'tel', label: 'Телефон', labelEn: 'Tel', kind: 'tel' },
      { key: 'email', label: 'Email', labelEn: 'Email', kind: 'email' },
      { key: 'postCode', label: 'Почтовый индекс', labelEn: 'Post code', latin: true, optional: true },
    ],
  },
  {
    key: 'languages',
    icon: 'translate',
    title: 'Языки',
    titleEn: 'Language Proficiency',
    fields: [
      {
        key: 'chineseProficiency',
        label: 'Уровень китайского',
        labelEn: 'Chinese Proficiency',
        kind: 'select',
        options: [
          { value: 'NONE', label: 'Не владею' },
          { value: 'A1', label: 'A1 — начальный' },
          { value: 'A2', label: 'A2 — элементарный' },
          { value: 'B1', label: 'B1 — средний' },
          { value: 'B2', label: 'B2 — выше среднего' },
          { value: 'C1', label: 'C1 — продвинутый' },
          { value: 'C2', label: 'C2 — свободный' },
          { value: 'NATIVE', label: 'Носитель' },
        ],
      },
      {
        key: 'hskLevel',
        label: 'Уровень HSK',
        labelEn: 'HSK Level',
        kind: 'select',
        options: [
          { value: 'NO', label: 'Нет' },
          { value: 'HSK1', label: 'HSK 1' },
          { value: 'HSK2', label: 'HSK 2' },
          { value: 'HSK3', label: 'HSK 3' },
          { value: 'HSK4', label: 'HSK 4' },
          { value: 'HSK5', label: 'HSK 5' },
          { value: 'HSK6', label: 'HSK 6' },
        ],
      },
      {
        key: 'englishProficiency',
        label: 'Уровень английского',
        labelEn: 'English Proficiency',
        kind: 'select',
        options: [
          { value: 'NONE', label: 'Не владею' },
          { value: 'A1', label: 'A1 — начальный' },
          { value: 'A2', label: 'A2 — элементарный' },
          { value: 'B1', label: 'B1 — средний' },
          { value: 'B2', label: 'B2 — выше среднего' },
          { value: 'C1', label: 'C1 — продвинутый' },
          { value: 'C2', label: 'C2 — свободный' },
          { value: 'NATIVE', label: 'Носитель' },
        ],
      },
      { key: 'toefl', label: 'TOEFL (балл)', labelEn: 'TOEFL Score', kind: 'number', min: 0, max: 120, optional: true },
      { key: 'ielts', label: 'IELTS (балл)', labelEn: 'IELTS Results', kind: 'number', min: 0, max: 9, optional: true },
    ],
  },
  {
    key: 'education',
    icon: 'school',
    title: 'Образование',
    titleEn: 'Education Background',
    table: {
      rowLabels: [
        'Начальная школа',
        'Средняя школа',
        'Старшая школа',
        'Бакалавриат',
        'Магистратура',
        'Языковые курсы',
      ],
      fixedRows: true,
      columns: [
        { key: 'schoolName', label: 'Название', labelEn: 'School Name', latin: true },
        { key: 'yearFrom', label: 'Год начала', labelEn: 'Year From', kind: 'year' },
        { key: 'yearTo', label: 'Год окончания', labelEn: 'Year To', kind: 'year' },
        { key: 'major', label: 'Специальность', labelEn: 'Major', latin: true, optional: true },
        { key: 'degree', label: 'Степень', labelEn: 'Degree', latin: true, optional: true },
      ],
    },
  },
  {
    key: 'work',
    icon: 'work',
    title: 'Опыт работы',
    titleEn: 'Work Experience',
    table: {
      minRows: 1,
      columns: [
        { key: 'unit', label: 'Организация', labelEn: 'Working Unit Name', latin: true },
        { key: 'yearFrom', label: 'Год начала', labelEn: 'Year From', kind: 'year' },
        { key: 'yearTo', label: 'Год окончания', labelEn: 'Year To', kind: 'year' },
        { key: 'position', label: 'Должность', labelEn: 'Position', latin: true },
        { key: 'place', label: 'Место работы', labelEn: 'Work Place', latin: true },
      ],
    },
  },
  {
    key: 'family',
    icon: 'groups',
    title: 'Семья',
    titleEn: 'Family of the Applicant',
    table: {
      rowLabels: ['Отец', 'Мать', 'Супруг(а)'],
      fixedRows: true,
      columns: [
        { key: 'fullName', label: 'ФИО', labelEn: 'Full Name', latin: true },
        { key: 'idNumber', label: 'Паспорт / ID', labelEn: 'ID / Passport', latin: true },
        { key: 'age', label: 'Возраст', labelEn: 'Age', kind: 'number' },
        { key: 'jobTitle', label: 'Должность', labelEn: 'Job Title', latin: true, optional: true },
        { key: 'workPlace', label: 'Место работы', labelEn: 'Work Place', latin: true, optional: true },
        { key: 'phone', label: 'Телефон', labelEn: 'Phone' },
        { key: 'email', label: 'Email', labelEn: 'E-mail', kind: 'email', optional: true },
      ],
    },
  },
];

/** Создаёт пустой объект формы с правильной структурой */
export function emptyForm(): any {
  const form: any = {};
  for (const s of FORM_SECTIONS) {
    if (s.fields) {
      form[s.key] = {};
      for (const f of s.fields) form[s.key][f.key] = '';
    } else if (s.table) {
      const rows = s.table.rowLabels?.length || s.table.minRows || 1;
      form[s.key] = Array.from({ length: rows }, () => {
        const row: any = {};
        for (const c of s.table!.columns) row[c.key] = '';
        return row;
      });
    }
  }
  return form;
}

/** Подсчитывает количество заполненных полей (optional не учитывается) */
export function countProgress(form: any): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const s of FORM_SECTIONS) {
    if (s.fields) {
      for (const f of s.fields) {
        if (f.optional) continue;
        total++;
        if (form?.[s.key]?.[f.key]?.toString().trim()) filled++;
      }
    } else if (s.table) {
      const rows = form?.[s.key] || [];
      for (const row of rows) {
        // Строки с пометкой "не учился" вообще не считаем
        if (row?.__notAttended) continue;
        for (const c of s.table.columns) {
          if (c.optional) continue;
          total++;
          if (row?.[c.key]?.toString().trim()) filled++;
        }
      }
    }
  }
  return { filled, total };
}

/** Регулярка латиница + цифры + базовые знаки пунктуации */
export const LATIN_RE = /^[A-Za-z0-9 .,'\-/()&+#@]*$/;
