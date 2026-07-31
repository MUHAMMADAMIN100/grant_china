import type { Ticket } from '../api/tickets';
import { TICKET_STATUS_LABEL } from '../api/tickets';
import { formatDateTimeRu } from './datetime';

/**
 * ТЗ «Билеты», п.2 — «массовый экспорт данных» для Администратора.
 *
 * CSV, а не XLSX: файл открывается Excel/Google Sheets одним кликом, весит
 * килобайты и не тянет за собой библиотеку в бандл (тот же приём, что у
 * exportPayrollCsv).
 *
 * BOM в начале обязателен: без него Excel на Windows читает UTF-8 как ANSI и
 * показывает кириллицу «крякозябрами» — а этим файлом пользуются именно в
 * Excel на Windows.
 */

const escapeCell = (value: string | number | null | undefined): string => {
  const s = value === null || value === undefined ? '' : String(value);
  // Кавычки удваиваются, вся ячейка берётся в кавычки — так внутри спокойно
  // живут точки с запятой, переводы строк и сами кавычки.
  return `"${s.replace(/"/g, '""')}"`;
};

export function exportTicketsCsv(tickets: Ticket[], meta?: { truncated?: boolean }): void {
  const header = [
    'Студент',
    'Телефон',
    'Город назначения',
    'Вылет',
    'Прилёт',
    'Рейс',
    'Авиакомпания',
    'Статус',
    'Комментарий',
    'Файл билета',
  ];

  const rows = tickets.map((t) =>
    [
      t.student?.fullName ?? '',
      (t.student?.phones ?? []).join(' / '),
      t.destinationCity,
      formatDateTimeRu(t.departureAt),
      formatDateTimeRu(t.arrivalAt),
      t.flightNumber,
      t.airline ?? '',
      TICKET_STATUS_LABEL[t.status],
      t.comment ?? '',
      t.documents.length ? 'да' : 'нет',
    ].map(escapeCell).join(';'),
  );

  // Разделитель «;» — Excel с русской локалью понимает именно его.
  const lines = [header.map(escapeCell).join(';'), ...rows];

  // Правило проекта — никаких тихих обрезаний: если выгрузили не всё,
  // пишем это прямо в файл, а не только в уведомление на экране.
  if (meta?.truncated) {
    lines.push('');
    lines.push(
      escapeCell('ВНИМАНИЕ: выгружены не все билеты — сузьте фильтр (период, статус, город) и повторите экспорт'),
    );
  }

  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
