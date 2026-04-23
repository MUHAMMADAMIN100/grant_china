import { FORM_SECTIONS, displayValue } from '../formSchema';

export async function generateStudentFormDocx(studentName: string, form: any): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ShadingType,
    AlignmentType,
  } = await import('docx');

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'D5D9DF' };
  const cellBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const labelCell = (text: string, width?: number) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      borders: cellBorders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF5F5' },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true, size: 18, color: '5B6478' })],
        }),
      ],
    });

  const valueCell = (text: string, width?: number) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      borders: cellBorders,
      children: [
        new Paragraph({
          children: [new TextRun({ text: text || '—', size: 20 })],
        }),
      ],
    });

  const headerCell = (text: string, width?: number) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      borders: cellBorders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D52B2B' },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })],
        }),
      ],
    });

  const sectionHeading = (text: string, textEn?: string) => [
    new Paragraph({
      spacing: { before: 300, after: 120 },
      children: [
        new TextRun({ text, bold: true, size: 28, color: 'D52B2B' }),
        ...(textEn
          ? [new TextRun({ text: `  ${textEn}`, italics: true, size: 20, color: '888888' })]
          : []),
      ],
    }),
  ];

  const children: any[] = [
    // Шапка
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'GrantChina', bold: true, size: 40, color: 'D52B2B' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Application Form', bold: true, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        new TextRun({
          text: `Student: ${studentName}  ·  Generated: ${new Date().toLocaleDateString('ru-RU')}`,
          size: 18,
          color: '5B6478',
        }),
      ],
    }),
  ];

  for (const section of FORM_SECTIONS) {
    children.push(...sectionHeading(section.title, section.titleEn));

    if (section.fields) {
      // Двухколоночная таблица label / value
      const rows = section.fields.map(
        (f) =>
          new TableRow({
            children: [
              labelCell(`${f.label}${f.labelEn ? ` (${f.labelEn})` : ''}`, 40),
              valueCell(displayValue(f, form?.[section.key]?.[f.key]), 60),
            ],
          }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }),
      );
    } else if (section.table) {
      const cols = section.table.columns;
      const rowLabels = section.table.rowLabels;
      const rows: any[] = [];

      // Шапка
      const headerCells = [];
      if (rowLabels) headerCells.push(headerCell('#', 15));
      for (const c of cols) {
        headerCells.push(headerCell(`${c.label}${c.labelEn ? ` / ${c.labelEn}` : ''}`));
      }
      rows.push(new TableRow({ tableHeader: true, children: headerCells }));

      const dataRows = form?.[section.key] || [];
      dataRows.forEach((row: any, ri: number) => {
        const cells = [];
        if (rowLabels) {
          cells.push(
            new TableCell({
              borders: cellBorders,
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF5F5' },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: rowLabels[ri] || `${ri + 1}`,
                      bold: true,
                      size: 16,
                      color: 'D52B2B',
                    }),
                  ],
                }),
              ],
            }),
          );
        }
        for (const c of cols) {
          cells.push(valueCell(displayValue(c, row?.[c.key])));
        }
        rows.push(new TableRow({ children: cells }));
      });

      if (rows.length > 1) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          }),
        );
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: '— не заполнено —', italics: true, color: '9CA3AF', size: 18 })],
          }),
        );
      }
    }
  }

  const doc = new Document({
    creator: 'GrantChina CRM',
    title: `Application Form — ${studentName}`,
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
          page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
