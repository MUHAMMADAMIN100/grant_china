import { saveAs } from 'file-saver';
import type { Student } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL } from '../api/types';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');

export async function generateStudentsReport(params: {
  students: Student[];
  from: string;
  to: string;
}) {
  const { students, from, to } = params;

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ShadingType,
    PageOrientation,
    Header,
    Footer,
    PageNumber,
  } = await import('docx');

  const periodText = `за период ${fmtDate(from)} — ${fmtDate(to)}`;
  const generatedAt = new Date().toLocaleString('ru-RU');

  const byStatus = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const byDirection = students.reduce<Record<string, number>>((acc, s) => {
    acc[s.direction] = (acc[s.direction] || 0) + 1;
    return acc;
  }, {});

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'D5D9DF' };
  const cellBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const headerCell = (text: string, width?: number) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.DXA } : undefined,
      borders: cellBorders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D52B2B' },
      children: [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
        }),
      ],
    });

  const bodyCell = (text: string, alt = false) =>
    new TableCell({
      borders: cellBorders,
      shading: alt ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F8FAFC' } : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text: text || '—', size: 18 })],
        }),
      ],
    });

  const tableRows: InstanceType<typeof TableRow>[] = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('№'),
        headerCell('ФИО'),
        headerCell('Направление'),
        headerCell('Кабинет'),
        headerCell('Статус'),
        headerCell('Телефон'),
        headerCell('Менеджер'),
        headerCell('Дата'),
      ],
    }),
    ...students.map(
      (s, i) =>
        new TableRow({
          children: [
            bodyCell(String(i + 1), i % 2 === 1),
            bodyCell(s.fullName, i % 2 === 1),
            bodyCell(DIRECTION_LABEL[s.direction], i % 2 === 1),
            bodyCell(String(s.cabinet), i % 2 === 1),
            bodyCell(STUDENT_STATUS_LABEL[s.status], i % 2 === 1),
            bodyCell(s.phones.join(', '), i % 2 === 1),
            bodyCell(s.manager?.fullName || '—', i % 2 === 1),
            bodyCell(fmtDate(s.createdAt), i % 2 === 1),
          ],
        }),
    ),
  ];

  const doc = new Document({
    creator: 'GrantChina CRM',
    title: `Отчёт по студентам ${periodText}`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 20 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: 'GrantChina — Отчёт по студентам', color: '888888', size: 16 }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `Сформировано: ${generatedAt}`, color: '888888', size: 16 }),
                  new TextRun({ text: '\tСтр. ', color: '888888', size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: '888888', size: 16 }),
                  new TextRun({ text: ' из ', color: '888888', size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '888888', size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'GrantChina', bold: true, color: 'D52B2B', size: 40 })],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Отчёт по студентам', bold: true, size: 32 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: periodText, color: '5B6478', size: 22 })],
            spacing: { after: 240 },
          }),

          new Paragraph({
            children: [new TextRun({ text: `Всего студентов: ${students.length}`, bold: true, size: 22 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: 'По статусам:', bold: true, size: 20 })],
            spacing: { before: 100 },
          }),
          ...Object.entries(byStatus).map(
            ([k, v]) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: `  • ${STUDENT_STATUS_LABEL[k as keyof typeof STUDENT_STATUS_LABEL] || k}: ${v}`,
                    size: 20,
                    color: '5B6478',
                  }),
                ],
              }),
          ),
          new Paragraph({
            children: [new TextRun({ text: 'По направлениям:', bold: true, size: 20 })],
            spacing: { before: 100 },
          }),
          ...Object.entries(byDirection).map(
            ([k, v]) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: `  • ${DIRECTION_LABEL[k as keyof typeof DIRECTION_LABEL] || k}: ${v}`,
                    size: 20,
                    color: '5B6478',
                  }),
                ],
              }),
          ),
          new Paragraph({ text: '', spacing: { after: 200 } }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const fileName = `grantchina-students-${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, fileName);
}
