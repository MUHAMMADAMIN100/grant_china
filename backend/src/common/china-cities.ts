/**
 * Раздел «Билеты» (волна 8) — справочник городов назначения в Китае.
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА: справочник + свободный ввод. Поэтому Ticket.destinationCity
 * в БД — String, а не enum:
 *  - выпадающий список закрывает 95% реальных маршрутов и не даёт расползтись
 *    написанию («Пекин» / «Beijing» / «Пекин.» разбили бы отчёт по городам);
 *  - редкий маршрут (Иньчуань, Хух-Хото) не блокирует работу менеджера —
 *    он вписывает город руками;
 *  - новый город это одна строка ЗДЕСЬ, а не ALTER TYPE на живой колонке
 *    (тот же приём, что у Application.source и Document.type).
 *
 * Порядок — по частоте направлений GrantChina, а не по алфавиту: менеджер
 * выбирает из первых пунктов в 9 случаях из 10.
 */
export interface ChinaCityOption {
  value: string;
  /** Латиница/пиньинь — помогает сверять с маршрутной квитанцией. */
  latin: string;
}

export const CHINA_CITIES: readonly ChinaCityOption[] = [
  { value: 'Пекин', latin: 'Beijing' },
  { value: 'Шанхай', latin: 'Shanghai' },
  { value: 'Гуанчжоу', latin: 'Guangzhou' },
  { value: 'Шэньчжэнь', latin: 'Shenzhen' },
  { value: 'Урумчи', latin: 'Urumqi' },
  { value: 'Сиань', latin: "Xi'an" },
  { value: 'Ханчжоу', latin: 'Hangzhou' },
  { value: 'Нанкин', latin: 'Nanjing' },
  { value: 'Ухань', latin: 'Wuhan' },
  { value: 'Чэнду', latin: 'Chengdu' },
  { value: 'Чунцин', latin: 'Chongqing' },
  { value: 'Тяньцзинь', latin: 'Tianjin' },
  { value: 'Циндао', latin: 'Qingdao' },
  { value: 'Далянь', latin: 'Dalian' },
  { value: 'Харбин', latin: 'Harbin' },
  { value: 'Шэньян', latin: 'Shenyang' },
  { value: 'Цзинань', latin: 'Jinan' },
  { value: 'Чжэнчжоу', latin: 'Zhengzhou' },
  { value: 'Куньмин', latin: 'Kunming' },
  { value: 'Ланьчжоу', latin: 'Lanzhou' },
  { value: 'Гуйлинь', latin: 'Guilin' },
  { value: 'Сямынь', latin: 'Xiamen' },
] as const;

export const CHINA_CITY_VALUES: readonly string[] = CHINA_CITIES.map((c) => c.value);

/**
 * Нормализует город перед записью: обрезает пробелы и схлопывает внутренние.
 * НЕ приводит к значению из справочника и НЕ отбрасывает незнакомое — по
 * решению заказчика свободный ввод разрешён. Единственная задача — не дать
 * появиться «Пекин » и «Пекин  » как двум разным городам в GROUP BY.
 */
export function normalizeCity(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}
