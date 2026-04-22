import type { Student } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL } from '../api/types';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');

export async function generateStudentsReport(params: {
  students: Student[];
  from?: string;
  to?: string;
}) {
  // Динамический импорт — pdfmake грузится только при реальном клике
  const pdfMakeModule = await import('pdfmake/build/pdfmake');
  const pdfFontsModule = await import('pdfmake/build/vfs_fonts');
  const pdfMake: any = (pdfMakeModule as any).default || pdfMakeModule;
  const pdfFonts: any = (pdfFontsModule as any).default || pdfFontsModule;
  pdfMake.vfs = pdfFonts.vfs || pdfFonts.pdfMake?.vfs;

  const { students, from, to } = params;

  const periodText = from && to
    ? `за период ${fmtDate(from)} — ${fmtDate(to)}`
    : from
      ? `с ${fmtDate(from)}`
      : to
        ? `до ${fmtDate(to)}`
        : 'за всё время';

  const generatedAt = new Date().toLocaleString('ru-RU');

  const tableBody: any[] = [
    [
      { text: '№', style: 'th' },
      { text: 'ФИО', style: 'th' },
      { text: 'Направление', style: 'th' },
      { text: 'Кабинет', style: 'th' },
      { text: 'Статус', style: 'th' },
      { text: 'Телефон', style: 'th' },
      { text: 'Менеджер', style: 'th' },
      { text: 'Дата', style: 'th' },
    ],
    ...students.map((s, i) => [
      { text: String(i + 1), style: 'td' },
      { text: s.fullName, style: 'td' },
      { text: DIRECTION_LABEL[s.direction], style: 'td' },
      { text: String(s.cabinet), style: 'td' },
      { text: STUDENT_STATUS_LABEL[s.status], style: 'td' },
      { text: s.phones.join(', ') || '—', style: 'td' },
      { text: s.manager?.fullName || '—', style: 'td' },
      { text: fmtDate(s.createdAt), style: 'td' },
    ]),
  ];

  const byStatus = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const byDirection = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.direction] = (acc[s.direction] || 0) + 1;
    return acc;
  }, {});

  const docDefinition: any = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 50, 28, 50],
    info: {
      title: `GrantChina — Отчёт по студентам ${periodText}`,
      author: 'GrantChina CRM',
    },
    header: (currentPage: number) =>
      currentPage === 1
        ? null
        : {
            text: 'GrantChina — Отчёт по студентам',
            alignment: 'right',
            margin: [0, 20, 28, 0],
            fontSize: 9,
            color: '#888888',
          },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Сформировано: ${generatedAt}`, alignment: 'left', margin: [28, 0, 0, 0], fontSize: 9, color: '#888888' },
        { text: `Стр. ${currentPage} из ${pageCount}`, alignment: 'right', margin: [0, 0, 28, 0], fontSize: 9, color: '#888888' },
      ],
    }),
    content: [
      { text: 'GrantChina', style: 'brand' },
      { text: 'Отчёт по студентам', style: 'title' },
      { text: periodText, style: 'subtitle' },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: `Всего студентов: ${students.length}`, style: 'summaryItem' },
              ...Object.entries(byStatus).map(([k, v]) => ({
                text: `• ${STUDENT_STATUS_LABEL[k as keyof typeof STUDENT_STATUS_LABEL] || k}: ${v}`,
                style: 'summarySub',
              })),
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'По направлениям:', style: 'summaryItem' },
              ...Object.entries(byDirection).map(([k, v]) => ({
                text: `• ${DIRECTION_LABEL[k as keyof typeof DIRECTION_LABEL] || k}: ${v}`,
                style: 'summarySub',
              })),
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#d52b2b' : rowIndex % 2 === 0 ? '#f8fafc' : null),
          hLineColor: () => '#e3e7ef',
          vLineColor: () => '#e3e7ef',
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
        },
      },
    ],
    styles: {
      brand: { fontSize: 20, bold: true, color: '#d52b2b', margin: [0, 0, 0, 4] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 11, color: '#5b6478', margin: [0, 0, 0, 14] },
      summaryItem: { fontSize: 11, bold: true, margin: [0, 0, 0, 4] },
      summarySub: { fontSize: 10, color: '#5b6478', margin: [0, 0, 0, 2] },
      th: { bold: true, fontSize: 10, color: 'white', margin: [4, 6, 4, 6] },
      td: { fontSize: 9, margin: [4, 4, 4, 4] },
    },
    defaultStyle: { font: 'Roboto' },
  };

  const fileName = `grantchina-students-${new Date().toISOString().slice(0, 10)}.pdf`;
  pdfMake.createPdf(docDefinition).download(fileName);
}
