import type { ArchiveSkip } from '../api/students';
import { plural } from './plural';

/**
 * 29.09.2026 — текст тоста по итогу «В архив» / «Вернуть из архива».
 *
 * Пачка может пройти частично: чужой студент, уже в архиве, параллельно
 * вернул коллега. Человек должен увидеть и сколько прошло, и почему не прошли
 * остальные — зелёный тост на всю пачку при трёх пропущенных врал бы.
 * Одна функция для списка «Студенты», раздела «Архив» и карточки — чтобы
 * одинаковое действие везде звучало одинаково.
 */
export function archiveResultToast(
  done: Array<{ fullName: string }>,
  skipped: ArchiveSkip[],
  mode: 'archive' | 'restore',
): { message: string; kind: 'success' | 'error' | 'info' } {
  const reasons = groupReasons(skipped);
  if (skipped.length === 0) {
    if (done.length === 1) {
      return {
        message: mode === 'archive'
          ? `Студент «${done[0].fullName}» отправлен в архив`
          : `Студент «${done[0].fullName}» возвращён из архива`,
        kind: 'success',
      };
    }
    const n = `${done.length} ${plural(done.length, 'студент', 'студента', 'студентов')}`;
    return { message: mode === 'archive' ? `Отправлено в архив: ${n}` : `Возвращено из архива: ${n}`, kind: 'success' };
  }
  if (done.length === 0) return { message: `Ничего не изменилось — ${reasons}`, kind: 'error' };
  const total = done.length + skipped.length;
  const verb = mode === 'archive' ? 'Отправлено в архив' : 'Возвращено из архива';
  return { message: `${verb}: ${done.length} из ${total}. Пропущено — ${reasons}`, kind: 'info' };
}

function groupReasons(skipped: ArchiveSkip[]): string {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, n]) => `${reason.toLowerCase()}${n > 1 ? ` (${n})` : ''}`)
    .join(', ');
}
