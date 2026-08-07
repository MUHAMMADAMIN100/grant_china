/**
 * Оптимистичные обновления списков.
 *
 * ЗАЧЕМ. Раньше каждое действие выглядело так:
 *
 *     await updateTask(id, { status });   // ждём сервер
 *     await load();                        // и заново тянем ВЕСЬ список
 *
 * Два похода на сервер на один клик, и всё это время интерфейс не отвечает.
 * На странице «Заявки» походов было три: PATCH + список + счётчики вкладок.
 *
 * Стало: состояние меняется сразу, запрос уходит следом. Совпало — ничего не
 * мигает; сервер отказал — состояние возвращается ровно в то, что было, и
 * человек видит причину отказа.
 *
 * ЧЕГО ЭТИМ ДЕЛАТЬ НЕЛЬЗЯ — деньги. Показать «платёж внесён» до подтверждения
 * сервера значит дать менеджеру сказать студенту «провёл», а через секунду
 * увидеть, как сумма исчезла. Решение заказчика: финансы (платежи, одобрения,
 * договоры, зарплатные листы) ждут ответ с обычным спиннером. Сюда же —
 * загрузка файлов (имя файла известно только после ответа) и операции, где
 * сервер считает производное значение: перевод гранта на следующий год,
 * смена статуса заявки (создаёт карточку студента и шлёт SMS), активация
 * набора правил бонусов.
 */

/** Возвращает снимок значения, пригодный для отката. Массивы копируются поверхностно. */
function snapshot<T>(value: T): T {
  return Array.isArray(value) ? ([...value] as unknown as T) : value;
}

export interface OptimisticOptions<TState, TResult> {
  /** Текущее состояние — из него делается снимок для отката. */
  current: TState;
  /** Как показать результат СРАЗУ. Получает текущее состояние, возвращает новое. */
  optimistic: (prev: TState) => TState;
  /** Куда записать состояние (обычно setState из useState). */
  commit: (next: TState) => void;
  /** Собственно запрос. */
  request: () => Promise<TResult>;
  /**
   * Что сделать с ответом сервера. Нужен, когда сервер возвращает поля, которые
   * клиент предсказать не может (id созданной записи, пересчитанные суммы,
   * даты). Если не задан — предсказанное состояние остаётся как есть.
   */
  reconcile?: (prev: TState, result: TResult) => TState;
  /** Показать причину отказа. Состояние к этому моменту уже откачено. */
  onError?: (message: string, error: unknown) => void;
}

/**
 * Применяет изменение локально, отправляет запрос, при ошибке откатывает.
 *
 * Возвращает результат запроса либо null при ошибке — вызывающий код может
 * решить, продолжать ли цепочку (например, закрывать ли модальное окно).
 */
export async function runOptimistic<TState, TResult>(
  opts: OptimisticOptions<TState, TResult>,
): Promise<TResult | null> {
  const before = snapshot(opts.current);
  opts.commit(opts.optimistic(before));

  try {
    const result = await opts.request();
    if (opts.reconcile) {
      // Сверяем с ОТКАТНЫМ снимком, а не с предсказанным: иначе повторное
      // применение изменения удвоило бы его (добавленная строка появилась бы
      // дважды — сначала предсказанная, потом настоящая).
      opts.commit(opts.reconcile(before, result));
    }
    return result;
  } catch (e: any) {
    opts.commit(before);
    const message =
      e?.response?.data?.message ||
      (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors.join(', ') : null) ||
      e?.message ||
      'Не удалось сохранить. Попробуйте ещё раз.';
    opts.onError?.(Array.isArray(message) ? message.join(', ') : String(message), e);
    return null;
  }
}

/** Заменить элемент списка по id. Не найден — список возвращается как был. */
export function replaceById<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

/** Убрать элемент по id. */
export function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((it) => it.id !== id);
}

/**
 * Временный идентификатор для строки, которой на сервере ещё нет.
 *
 * Префикс делает такие строки отличимыми: по нему интерфейс понимает, что
 * запись ещё не подтверждена, и не даёт по ней действий, требующих настоящего
 * id (открыть карточку, удалить, приложить файл).
 */
export function tempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** true — строка ещё не подтверждена сервером. */
export function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}
