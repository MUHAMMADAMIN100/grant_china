import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

/**
 * ТЗ v3 раздел 2, критерий приёмки (решение заказчика): до 15 файлов ЗА ОДНУ
 * загрузку. Ограничение именно на порцию, а не на платёж — догрузить ещё
 * пятнадцать можно следующим действием, общее число чеков не ограничено.
 * Значение продублировано на бэкенде (payments.controller.ts MAX_RECEIPT_FILES);
 * здесь оно нужно, чтобы объяснить границу ДО отправки, а не отказом сервера.
 */
export const MAX_RECEIPT_FILES = 15;

/** Совпадает с RECEIPT_MAX_FILE_SIZE в payments.controller.ts. */
const MAX_RECEIPT_FILE_BYTES = 20 * 1024 * 1024;

// Форматы из ТЗ v3 раздел 2: PDF, JPG, PNG, WEBP, HEIC, DOCX. accept —
// подсказка диалогу выбора файла, но не гарантия (drag-and-drop его вообще
// игнорирует), поэтому ниже стоит настоящая проверка теми же двумя правилами,
// что и на сервере: сначала MIME, затем расширение. Расширение — не
// перестраховка: у HEIC с iPhone и у DOCX браузер сплошь и рядом отдаёт пустой
// type, и проверка только по MIME отбивала бы валидный файл.
const ALLOWED_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx';

const ALLOWED_MIME_RE =
  /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;
const ALLOWED_EXT_RE = /\.(jpe?g|png|webp|heic|heif|pdf|docx)$/i;

// HEIC/HEIF браузеры не рисуют (кроме Safari) — <img> молча схлопнулся бы в
// битую картинку. Такие файлы показываем иконкой, как PDF и DOCX.
const RENDERABLE_IMAGE_RE = /^image\/(jpeg|jpg|png|webp)$/i;
const RENDERABLE_EXT_RE = /\.(jpe?g|png|webp)$/i;

const isRenderableImage = (f: File) =>
  RENDERABLE_IMAGE_RE.test(f.type) || (!f.type && RENDERABLE_EXT_RE.test(f.name));

const iconFor = (f: File) => {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    return { name: 'picture_as_pdf', color: 'var(--danger)' };
  }
  if (/\.docx$/i.test(f.name)) return { name: 'description', color: '#2b579a' };
  return { name: 'image', color: 'var(--text-soft)' };
};

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

/** Один и тот же файл, выбранный дважды. File-объекты всегда разные, сравниваем по содержимому метаданных. */
const isSameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  /** Подпись под полем — используется для объяснения обязательности чека (ТЗ 1.3). */
  hint?: string;
  /** Красная рамка + текст, когда чек обязателен, а его нет. */
  error?: string;
  /** На время сохранения формы — чтобы список не менялся под уже улетающим запросом. */
  disabled?: boolean;
};

/**
 * Выбор чеков/квитанций с предпросмотром списка ДО сохранения (ТЗ v3 раздел 2).
 * НЕ делает загрузку сама — File[] поднимается наверх и отправляется вместе с
 * остальной формой (создание платежа — multipart-запрос, см. payments.service.ts).
 *
 * Раньше компонент принимал ровно один `file: File | null`, и второй чек в
 * модалке оплаты приложить было физически некуда.
 */
export default function ReceiptDropzone({ files, onChange, hint, error, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Что именно не приняли из последнего выбора — иначе файл пропадал бы молча. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Пары «файл → blob-ссылка». Только для картинок, которые браузер умеет нарисовать. */
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);

  /**
   * Превью пересоздаются на КАЖДОЕ изменение списка, и старые ссылки тут же
   * освобождаются в cleanup. Без revokeObjectURL каждый выбор файлов навсегда
   * оставлял бы блобы в памяти вкладки: пятнадцать фото с телефона — это
   * десятки мегабайт, которые не соберёт GC, пока жива страница, и утечка
   * копится при каждом открытии модалки оплаты.
   *
   * Пересоздавать ссылки для уже показанных файлов дороже, чем кэшировать, но
   * безопаснее: инкрементальный кэш пришлось бы инвалидировать вручную, а любая
   * ошибка в нём — это либо та же утечка, либо превью уже удалённого файла.
   *
   * Ключ пары — сам объект File, а не индекс в массиве. При удалении файла из
   * середины списка все последующие сдвигаются, и привязка по индексу на один
   * кадр показала бы чужую миниатюру (у соседа по списку) — привязка по
   * идентичности этого не допускает в принципе.
   */
  useEffect(() => {
    const created = files
      .filter(isRenderableImage)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(created);
    return () => {
      created.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [files]);

  const previewFor = (f: File) => previews.find((p) => p.file === f)?.url;

  const appendFiles = (incoming: FileList | File[] | null | undefined) => {
    const picked = Array.from(incoming || []);
    if (picked.length === 0) return;

    const badFormat: string[] = [];
    const tooBig: string[] = [];
    const accepted: File[] = [];

    for (const f of picked) {
      if (!ALLOWED_MIME_RE.test(f.type) && !ALLOWED_EXT_RE.test(f.name)) {
        badFormat.push(f.name);
        continue;
      }
      if (f.size > MAX_RECEIPT_FILE_BYTES) {
        tooBig.push(f.name);
        continue;
      }
      accepted.push(f);
    }

    const merged = [...files];
    let duplicates = 0;
    for (const f of accepted) {
      if (merged.some((m) => isSameFile(m, f))) {
        duplicates += 1;
        continue;
      }
      merged.push(f);
    }

    const overflow = Math.max(0, merged.length - MAX_RECEIPT_FILES);
    const next = overflow > 0 ? merged.slice(0, MAX_RECEIPT_FILES) : merged;

    const problems: string[] = [];
    if (badFormat.length) problems.push(`неподдерживаемый формат: ${badFormat.join(', ')}`);
    if (tooBig.length) problems.push(`больше 20 МБ: ${tooBig.join(', ')}`);
    if (duplicates) problems.push(`уже в списке: ${duplicates}`);
    if (overflow) problems.push(`не поместилось ${overflow} — максимум ${MAX_RECEIPT_FILES} файлов за раз`);
    setNotice(problems.length ? `Пропущено — ${problems.join('; ')}` : null);

    // Сравниваем длину, а не ссылку: если не принято ничего, лишний onChange
    // пересоздал бы массив в родителе и, как следствие, все blob-превью.
    if (next.length !== files.length) onChange(next);
  };

  const removeAt = (index: number) => {
    setNotice(null);
    onChange(files.filter((_, i) => i !== index));
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    appendFiles(e.dataTransfer.files);
  };

  const full = files.length >= MAX_RECEIPT_FILES;

  return (
    <div className="form-group">
      <label>
        Чеки / квитанции
        {files.length > 0 && (
          <span style={{ marginLeft: 8, fontWeight: 500, color: full ? 'var(--danger)' : 'var(--text-soft)' }}>
            выбрано {files.length} из {MAX_RECEIPT_FILES}
          </span>
        )}
      </label>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {files.map((f, i) => {
            const icon = iconFor(f);
            const previewUrl = previewFor(f);
            return (
              <div className="receipt-dropzone-preview" key={`${f.name}-${f.size}-${f.lastModified}-${i}`}>
                {previewUrl ? (
                  <img src={previewUrl} alt="" />
                ) : (
                  <Icon name={icon.name} size={32} style={{ color: icon.color }} />
                )}
                <div className="receipt-dropzone-filename" title={f.name}>
                  {f.name}
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{fmtBytes(f.size)}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => removeAt(i)}
                  disabled={disabled}
                  title="Убрать файл"
                  aria-label={`Убрать файл ${f.name}`}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Зона выбора остаётся видимой и когда файлы уже есть — иначе добавить
          второй чек было бы некуда, ровно та проблема, из-за которой правится
          этот компонент. Прячем только при достижении лимита. */}
      {full ? (
        <div className="receipt-dropzone-hint">
          Достигнут максимум ({MAX_RECEIPT_FILES} файлов за одну загрузку). Сохраните платёж — остальные чеки можно
          догрузить в режиме редактирования.
        </div>
      ) : (
        <div
          className={`receipt-dropzone-btn${dragOver ? ' drag-over' : ''}${error ? ' has-error' : ''}`}
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        >
          <Icon name="upload_file" size={24} />
          <span>
            {files.length > 0
              ? 'Перетащите ещё файлы сюда или нажмите, чтобы выбрать'
              : 'Перетащите файлы сюда или нажмите, чтобы выбрать'}
          </span>
          <span className="receipt-dropzone-formats">
            JPG, PNG, WEBP, HEIC, PDF, DOCX — до 20 МБ каждый, до {MAX_RECEIPT_FILES} файлов за раз
          </span>
        </div>
      )}

      {notice && <div className="form-error-text">{notice}</div>}
      {hint && <div className="receipt-dropzone-hint">{hint}</div>}
      {error && <div className="form-error-text">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_ACCEPT}
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          appendFiles(e.target.files);
          // Сброс обязателен: без него повторный выбор ТОГО ЖЕ файла (например
          // после удаления его из списка) не вызовет onChange — значение input
          // не изменилось.
          e.target.value = '';
        }}
      />
    </div>
  );
}
