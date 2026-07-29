/**
 * Multer кладёт original filename в latin1 (HTTP RFC). Кириллица превращается
 * в "Đ¤Đ¾Ñ‚Đ¾_34.jpg" вместо "Фото_34.jpg". Конвертируем обратно в UTF-8,
 * только если результат явно не-ASCII (иначе оставляем как есть, чтобы не
 * сломать легитимные имена с латиницей).
 *
 * Раньше эта функция была продублирована в students.controller.ts — теперь
 * единственный источник, чтобы payments.controller.ts (загрузка чеков)
 * переиспользовал ровно ту же логику, а не копию, которая может разъехаться.
 */
export function fixFilenameEncoding(name: string): string {
  if (!name) return name;
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    // Если в utf8 нет битых символов U+FFFD — это нормальная кодировка
    if (!utf8.includes('�')) return utf8;
  } catch {
    // ignore
  }
  return name;
}
