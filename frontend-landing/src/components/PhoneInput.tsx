import { useEffect, useMemo, useState } from 'react';

export type Country = {
  code: string;
  flag: string;
  label: string;
  minDigits: number;
  maxDigits: number;
};

// Везде максимум 9 цифр (по требованию заказчика — формат TJ-номеров).
export const COUNTRIES: Country[] = [
  { code: '+992', flag: '🇹🇯', label: 'Таджикистан', minDigits: 9, maxDigits: 9 },
  { code: '+7',   flag: '🇷🇺', label: 'Россия',      minDigits: 9, maxDigits: 9 },
  { code: '+7',   flag: '🇰🇿', label: 'Казахстан',   minDigits: 9, maxDigits: 9 },
  { code: '+998', flag: '🇺🇿', label: 'Узбекистан',  minDigits: 9, maxDigits: 9 },
  { code: '+996', flag: '🇰🇬', label: 'Кыргызстан',  minDigits: 9, maxDigits: 9 },
  { code: '+86',  flag: '🇨🇳', label: 'Китай',       minDigits: 9, maxDigits: 9 },
];

const findCountryByPhone = (phone: string): { idx: number; rest: string } => {
  if (!phone) return { idx: 0, rest: '' };
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  // Сортируем по длине кода — длинные сначала, чтобы +998 не падал в +7
  const sorted = COUNTRIES.map((c, i) => ({ c, i })).sort((a, b) => b.c.code.length - a.c.code.length);
  for (const { c, i } of sorted) {
    if (normalized.startsWith(c.code)) {
      return { idx: i, rest: normalized.slice(c.code.length).replace(/\D/g, '') };
    }
  }
  return { idx: 0, rest: normalized.replace(/\D/g, '') };
};

interface Props {
  /** Полный номер с кодом, например "+992123456789" */
  value: string;
  /** Отдаём полный номер с кодом */
  onChange: (fullPhone: string) => void;
  /** Класс ошибки */
  error?: boolean;
  placeholder?: string;
}

/**
 * Универсальное поле телефона с селектором кода страны.
 * Хранит и принимает полный номер с кодом ("+992...").
 * По умолчанию подставляет +992.
 */
export default function PhoneInput({ value, onChange, error, placeholder }: Props) {
  const initial = useMemo(() => findCountryByPhone(value || '+992'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [countryIdx, setCountryIdx] = useState(initial.idx);
  const [local, setLocal] = useState(initial.rest);

  // Если внешний value сменился извне — пересчитать
  useEffect(() => {
    if (!value) {
      // оставляем выбранный код, очищаем локальную часть
      setLocal('');
      return;
    }
    const parsed = findCountryByPhone(value);
    if (parsed.idx !== countryIdx || parsed.rest !== local) {
      setCountryIdx(parsed.idx);
      setLocal(parsed.rest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const country = COUNTRIES[countryIdx];

  const update = (idx: number, digits: string) => {
    setCountryIdx(idx);
    setLocal(digits);
    const c = COUNTRIES[idx];
    onChange(digits ? `${c.code}${digits}` : '');
  };

  return (
    <div className={`phone-input-wrap${error ? ' input-error' : ''}`}>
      <select
        className="phone-country"
        value={countryIdx}
        onChange={(e) => update(Number(e.target.value), local)}
      >
        {COUNTRIES.map((c, i) => (
          <option key={`${c.code}-${c.label}`} value={i}>
            {c.flag} {c.code} ({c.label})
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={local}
        maxLength={country.maxDigits}
        placeholder={placeholder || '9'.repeat(country.minDigits)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, country.maxDigits);
          update(countryIdx, digits);
        }}
      />
    </div>
  );
}
