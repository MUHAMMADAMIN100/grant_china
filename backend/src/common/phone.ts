/**
 * Единственная реализация нормализации телефона на весь проект (раздел 3.1
 * ТЗ — «повторное обращение»). phone хранится так, как ввёл клиент
 * («+992 90 123-45-67», «901234567»), сравнивать сырые строки бесполезно.
 *
 * Правило:
 *  - оставляем только цифры;
 *  - меньше 7 цифр — телефон нераспознаваем, возвращаем null (а НЕ пустую
 *    строку — Prisma превратила бы `{ phoneNormalized: '' }` в точное
 *    сравнение и молча склеила бы все нераспознанные номера в одну «семью»,
 *    поэтому вызывающий код обязан явно проверять null и не строить по нему
 *    запрос вовсе — см. common/application-repeat.ts);
 *  - 12 цифр, начинается с '992' (код Таджикистана) — берём последние 9
 *    (национальный номер без кода страны);
 *  - длиннее 10 цифр (иностранный номер с кодом страны) — последние 10;
 *  - иначе — как есть.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 12 && digits.startsWith('992')) return digits.slice(-9);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/**
 * ТЗ v3 раздел 1 — минимальная длина запроса, при которой поиск считается
 * поиском по телефону. Три цифры: короче искать бессмысленно (найдётся
 * половина базы), а требовать полный номер — ровно та проблема, которую ТЗ
 * и просит убрать.
 */
const MIN_PHONE_QUERY_DIGITS = 3;

/**
 * ТЗ v3 раздел 1 — «поиск должен корректно находить записи независимо от
 * формата ввода (с кодом страны +992, +86, с пробелами, дефисами или без них)».
 *
 * Превращает пользовательский ввод в подстроку для поиска: оставляет только
 * цифры. Возвращает null, если цифр слишком мало — тогда вызывающий код
 * обязан НЕ добавлять условие по телефону вовсе, иначе запрос «Иван» (0 цифр)
 * превратился бы в `contains ''` и совпал бы со всеми записями сразу.
 */
export function phoneQuery(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_QUERY_DIGITS ? digits : null;
}

/**
 * ТЗ v3 раздел 1 — собирает поисковую строку для Student.phoneSearch.
 *
 * Для каждого номера кладём ДВЕ формы: «только цифры» (как ввели, с кодом
 * страны) и результат normalizePhone() (национальный номер без кода). Иначе
 * поиск работал бы только в одну сторону: студент, записанный как
 * «+992901234567», не находился бы по «901234567», и наоборот.
 *
 * Формы разделяются пробелом и дедуплицируются — для короткого номера обе
 * формы совпадают, и хранить его дважды незачем.
 *
 * Возвращает null, если распознаваемых цифр нет вовсе: пустая строка в
 * phoneSearch совпала бы с любым `contains`, превратив студента без телефона
 * в результат каждого поиска.
 */
export function buildPhoneSearch(phones: readonly (string | null | undefined)[] | null | undefined): string | null {
  if (!phones || phones.length === 0) return null;
  const parts = new Set<string>();
  for (const raw of phones) {
    if (!raw) continue;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length >= MIN_PHONE_QUERY_DIGITS) parts.add(digits);
    const normalized = normalizePhone(raw);
    if (normalized) parts.add(normalized);
  }
  return parts.size ? [...parts].join(' ') : null;
}
