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
/**
 * ТЗ v3 раздел 1 — ВАРИАНТЫ поисковой подстроки для одного пользовательского
 * запроса. Их два, и оба обязательны.
 *
 * Причина в том, что номер могли записать по-разному. buildPhoneSearch кладёт
 * обе формы только для ТОГО, КАК номер введён:
 *   записан «+992901234567» -> phoneSearch = «992901234567 901234567»
 *   записан «901234567»     -> phoneSearch = «901234567»
 * Во втором случае запрос с кодом страны («+992 90 123-45-67» -> цифры
 * «992901234567») подстрокой не совпадёт ни с чем, и студент не найдётся.
 * Поэтому к цифрам запроса добавляется его национальная форма — результат
 * normalizePhone, который срезает код страны.
 *
 * Обратный случай (записан с кодом, ищут без) закрывается первой формой.
 *
 * Одна функция на весь проект намеренно: до неё это условие писали в шести
 * сервисах вручную, и в четырёх из них вторую форму забыли.
 */
export function phoneSearchVariants(raw: string | null | undefined): string[] {
  const digits = phoneQuery(raw);
  const national = normalizePhone(raw);
  const variants: string[] = [];
  if (digits) variants.push(digits);
  if (national && national !== digits) variants.push(national);
  return variants;
}

/**
 * Готовые условия Prisma `{ <field>: { contains: ... } }` для OR-блока.
 *
 * Возвращает ПУСТОЙ массив, если в запросе нет распознаваемых цифр. Это не
 * мелочь: условие `contains: ''` совпадает с любой непустой строкой, и один
 * такой элемент в OR превращает поиск по имени в выгрузку всей базы.
 * Вызывающий код должен просто раскрыть результат в OR — проверять ничего не
 * нужно, пустой массив ничего не добавит.
 */
export function phoneContainsConditions<F extends string>(
  field: F,
  raw: string | null | undefined,
): Array<Record<F, { contains: string }>> {
  return phoneSearchVariants(raw).map(
    (variant) => ({ [field]: { contains: variant } }) as Record<F, { contains: string }>,
  );
}

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
