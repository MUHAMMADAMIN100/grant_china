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
 *   const [filters, setFilter, resetFilters] = useUrlFilter({
 *     search: '',
 *     status: '',
 *     page: '1',
 *   });
 *
 *   filters.search           // текущее значение из URL (или дефолт)
 *   setFilter('search', 'x') // обновляет ?search=x
 *   setFilter('search', '')  // удаляет search из URL (вернётся к дефолту)
 *   resetFilters()           // удаляет все ключи из URL
 *
 * Дефолтные значения НЕ пишутся в URL — он остаётся чистым.
 */
export function useUrlFilter<T extends Record<string, string>>(
  defaults: T,
): [T, (key: keyof T, value: string) => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const val = searchParams.get(key as string);
      if (val !== null) (result as any)[key] = val;
    }
    return result;
  }, [searchParams, defaults]);

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      const next = new URLSearchParams(searchParams);
      const defaultValue = defaults[key];
      if (!value || value === defaultValue) {
        next.delete(key as string);
      } else {
        next.set(key as string, value);
      }
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams, defaults],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  return [filters, setFilter, resetFilters];
}
