// Универсальные валидаторы для форм CRM. Каждая функция возвращает
// строку-ошибку или undefined, если значение валидно.

export type Rule = (v: any) => string | undefined;

export const required = (msg = 'Обязательное поле'): Rule =>
  (v) => (v === undefined || v === null || String(v).trim() === '' ? msg : undefined);

export const minLen = (n: number, msg?: string): Rule =>
  (v) => (String(v ?? '').trim().length < n ? (msg || `Минимум ${n} символов`) : undefined);

export const maxLen = (n: number, msg?: string): Rule =>
  (v) => (String(v ?? '').length > n ? (msg || `Максимум ${n} символов`) : undefined);

export const email = (msg = 'Некорректный email'): Rule => (v) => {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) ? undefined : msg;
};

export const numberRule = (opts: { min?: number; max?: number; integer?: boolean } = {}): Rule => (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return 'Должно быть числом';
  if (opts.integer && !Number.isInteger(n)) return 'Должно быть целым числом';
  if (opts.min !== undefined && n < opts.min) return `Не меньше ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `Не больше ${opts.max}`;
  return undefined;
};

export const positive = (msg = 'Должно быть больше нуля'): Rule => (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return msg;
  return undefined;
};

// Везде требуем ровно 9 цифр в номере (без учёта кода страны вроде "+992").
// Если в строку включён код "+992..." — суммарно получится 12 цифр; засчитываем
// последние 9 как "номер абонента".
export const phoneRule = (msg = 'Номер должен содержать 9 цифр'): Rule => (v) => {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const digits = s.replace(/\D/g, '');
  // Берём последние 9 цифр — они должны существовать (т.е. всего >= 9 цифр)
  // и общий ввод не должен быть «обрезанным».
  if (digits.length < 9) return 'Номер слишком короткий — нужно 9 цифр';
  // Допускаем код страны: всего цифр не больше 9 (без кода) или 12 (с +992).
  if (digits.length > 12) return msg;
  return undefined;
};

export const passwordRule = (msg = 'Минимум 8 символов, буквы и цифры'): Rule => (v) => {
  const s = String(v ?? '');
  if (!s) return undefined;
  if (s.length < 8) return 'Минимум 8 символов';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return msg;
  return undefined;
};

export const noBadChars = (msg = 'Недопустимые символы'): Rule => (v) => {
  const s = String(v ?? '');
  if (/[<>{}[\]\\]/.test(s)) return msg;
  return undefined;
};

export const compose = (...rules: Rule[]): Rule => (v) => {
  for (const r of rules) {
    const e = r(v);
    if (e) return e;
  }
  return undefined;
};

/** Валидирует объект по карте { field: Rule }. Возвращает map с ошибками. */
export function validateAll<T extends Record<string, any>>(
  values: T,
  rules: Partial<Record<keyof T, Rule>>,
): Partial<Record<keyof T, string>> {
  const errors: Partial<Record<keyof T, string>> = {};
  (Object.keys(rules) as (keyof T)[]).forEach((k) => {
    const rule = rules[k];
    if (!rule) return;
    const err = rule(values[k]);
    if (err) errors[k] = err;
  });
  return errors;
}

export const hasErrors = (errs: Record<string, string | undefined>) =>
  Object.values(errs).some(Boolean);
