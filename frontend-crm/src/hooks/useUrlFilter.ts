import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

/**
 * Хранит фильтры списка в URL query params вместо локального useState.
 * Это даёт три плюса:
 *  1. Browser back/forward — фильтры восстанавливаются автоматически.
 *  2. Refresh страницы — фильтры остаются.
 *  3. URL шаренный — можно скопировать ссылку с фильтром и отправить
 *     коллеге, у него откроется тот же список.
 *
 * API:
 *   const [filters, setFilter, setFilters, resetFilters] = useUrlFilter({
 *     search: '',
 *     status: '',
 *     page: '1',
 *   });
 *
 *   filters.search                              // текущее значение из URL
 *   setFilter('search', 'x')                    // обновляет ?search=x
 *   setFilter('search', '')                     // удаляет search из URL
 *   setFilters({ search: 'x', page: '1' })      // АТОМАРНО обновляет несколько
 *   resetFilters()                              // удаляет все ключи
 *
 * Дефолтные значения НЕ пишутся в URL — он остаётся чистым.
 *
 * Все мутации используют функциональную форму setSearchParams чтобы
 * избежать гонок при последовательных вызовах в одном тике
 * (`setFilter('search', x); setFilter('page', '1')`).
 */
export function useUrlFilter<T extends Record<string, string>>(
  defaults: T,
): [
  T,
  (key: keyof T, value: string) => void,
  (patch: Partial<Record<keyof T, string>>) => void,
  () => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const val = searchParams.get(key as string);
      if (val !== null) (result as any)[key] = val;
    }
    return result;
    // searchParams.toString() — стабильное представление, useMemo по нему
    // корректно пересчитывает результат при изменении URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), defaults]);

  // Применяем patch к существующим searchParams. Дефолтные значения
  // удаляются из URL чтобы он оставался чистым.
  const applyPatch = useCallback(
    (patch: Partial<Record<keyof T, string>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of Object.keys(patch) as (keyof T)[]) {
            const value = patch[key];
            const defaultValue = defaults[key];
            if (value === undefined) continue;
            if (!value || value === defaultValue) {
              next.delete(key as string);
            } else {
              next.set(key as string, value);
            }
          }
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams, defaults],
  );

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      applyPatch({ [key]: value } as Partial<Record<keyof T, string>>);
    },
    [applyPatch],
  );

  const setFilters = useCallback(
    (patch: Partial<Record<keyof T, string>>) => applyPatch(patch),
    [applyPatch],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  return [filters, setFilter, setFilters, resetFilters];
}
