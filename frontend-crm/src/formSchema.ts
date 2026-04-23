export type FieldKind = 'text' | 'date' | 'email' | 'tel' | 'number' | 'textarea' | 'radio';

export interface FieldDef {
  key: string;
  label: string;
  labelEn?: string;
  kind?: FieldKind;
  options?: { value: string; label: string }[];
}

export interface SectionDef {
  key: string;
  icon: string;
  title: string;
  titleEn?: string;
  fields?: FieldDef[];
  table?: {
    columns: FieldDef[];
    rowLabels?: string[];
    fixedRows?: boolean;
  };
}

export const FORM_SECTIONS: SectionDef[] = [
  {
    key: 'personal',
    icon: 'person',
    title: 'Личные данные',
    titleEn: 'Personal Information',
    fields: [
      { key: 'surname', label: 'Фамилия', labelEn: 'Surname' },
      { key: 'givenName', label: 'Имя', labelEn: 'Given name' },
      { key: 'birthDate', label: 'Дата рождения', labelEn: 'Date of Birth' },
      { key: 'birthPlace', label: 'Место рождения', labelEn: 'Place of Birth' },
      { key: 'nationality', label: 'Национальность', labelEn: 'Nationality' },
      { key: 'currentCountry', label: 'Страна / город', labelEn: 'Present Country/City' },
      { key: 'passportNumber', label: 'Номер паспорта', labelEn: 'Passport No.' },
      { key: 'passportExpiry', label: 'Срок паспорта', labelEn: 'Passport Expiration' },
      {
        key: 'gender',
        label: 'Пол',
        labelEn: 'Gender',
        options: [
          { value: 'MALE', label: 'Мужской' },
          { value: 'FEMALE', label: 'Женский' },
        ],
      },
      { key: 'religion', label: 'Религия', labelEn: 'Religion' },
      { key: 'nativeLanguage', label: 'Родной язык', labelEn: 'Native Language' },
      { key: 'officialLanguage', label: 'Официальный язык', labelEn: 'Official Language' },
      {
        key: 'maritalStatus',
        label: 'Семейное положение',
        labelEn: 'Marital Status',
        options: [
          { value: 'SINGLE', label: 'Холост / не замужем' },
          { value: 'MARRIED', label: 'В браке' },
          { value: 'OTHER', label: 'Другое' },
        ],
      },
      {
        key: 'educationLevel',
        label: 'Уровень образования',
        labelEn: 'Highest Education',
        options: [
          { value: 'HIGH_SCHOOL', label: 'Средняя школа' },
          { value: 'BACHELOR', label: 'Бакалавр' },
          { value: 'MASTER', label: 'Магистр' },
          { value: 'PHD', label: 'PhD' },
        ],
      },
      {
        key: 'inChina',
        label: 'Сейчас в Китае?',
        labelEn: 'In China?',
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
    title: 'Адрес',
    titleEn: 'Address',
    fields: [
      { key: 'home', label: 'Домашний адрес', labelEn: 'Home Address' },
      { key: 'tel', label: 'Телефон', labelEn: 'Tel' },
      { key: 'email', label: 'Email', labelEn: 'Email' },
      { key: 'postCode', label: 'Индекс', labelEn: 'Post code' },
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
        label: 'Китайский',
        labelEn: 'Chinese',
        options: [
          { value: 'EXCELLENT', label: 'Отлично' },
          { value: 'GOOD', label: 'Хорошо' },
          { value: 'POOR', label: 'Слабо' },
          { value: 'NONE', label: 'Нет' },
        ],
      },
      {
        key: 'hskLevel',
        label: 'HSK',
        labelEn: 'HSK Level',
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
        label: 'Английский',
        labelEn: 'English',
        options: [
          { value: 'EXCELLENT', label: 'Отлично' },
          { value: 'GOOD', label: 'Хорошо' },
          { value: 'POOR', label: 'Слабо' },
          { value: 'NONE', label: 'Нет' },
        ],
      },
      { key: 'toefl', label: 'TOEFL', labelEn: 'TOEFL Score' },
      { key: 'ielts', label: 'IELTS', labelEn: 'IELTS Results' },
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
        { key: 'schoolName', label: 'Название', labelEn: 'School Name' },
        { key: 'years', label: 'Годы', labelEn: 'Years' },
        { key: 'major', label: 'Специальность', labelEn: 'Major' },
        { key: 'degree', label: 'Степень', labelEn: 'Degree' },
      ],
    },
  },
  {
    key: 'work',
    icon: 'work',
    title: 'Опыт работы',
    titleEn: 'Work Experience',
    table: {
      columns: [
        { key: 'unit', label: 'Организация', labelEn: 'Working Unit' },
        { key: 'years', label: 'Годы', labelEn: 'Years' },
        { key: 'position', label: 'Должность', labelEn: 'Position' },
        { key: 'place', label: 'Место работы', labelEn: 'Work Place' },
      ],
    },
  },
  {
    key: 'family',
    icon: 'groups',
    title: 'Семья',
    titleEn: 'Family',
    table: {
      rowLabels: ['Отец', 'Мать', 'Супруг(а)'],
      fixedRows: true,
      columns: [
        { key: 'fullName', label: 'ФИО', labelEn: 'Full Name' },
        { key: 'idNumber', label: 'Паспорт', labelEn: 'ID' },
        { key: 'age', label: 'Возраст', labelEn: 'Age' },
        { key: 'jobTitle', label: 'Должность', labelEn: 'Job Title' },
        { key: 'workPlace', label: 'Место работы', labelEn: 'Work Place' },
        { key: 'phone', label: 'Телефон', labelEn: 'Phone' },
        { key: 'email', label: 'Email', labelEn: 'Email' },
      ],
    },
  },
];

export function countProgress(form: any): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const s of FORM_SECTIONS) {
    if (s.fields) {
      for (const f of s.fields) {
        total++;
        if (form?.[s.key]?.[f.key]?.toString().trim()) filled++;
      }
    } else if (s.table) {
      const rows = form?.[s.key] || [];
      for (const row of rows) {
        for (const c of s.table.columns) {
          total++;
          if (row?.[c.key]?.toString().trim()) filled++;
        }
      }
    }
  }
  return { filled, total };
}

export function displayValue(def: FieldDef, raw: any): string {
  const v = raw?.toString().trim();
  if (!v) return '—';
  if (def.options) {
    const opt = def.options.find((o) => o.value === v);
    return opt?.label || v;
  }
  return v;
}
