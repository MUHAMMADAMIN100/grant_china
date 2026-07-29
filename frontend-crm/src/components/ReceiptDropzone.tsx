import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

const ALLOWED_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Подпись под полем — используется для объяснения обязательности чека (ТЗ 1.3). */
  hint?: string;
  /** Красная рамка + текст, когда чек обязателен, а его нет. */
  error?: string;
};

/**
 * Выбор файла чека/квитанции с превью. НЕ делает загрузку сама — File
 * поднимается наверх и отправляется вместе с остальной формой (создание
 * платежа — атомарный multipart-запрос на бэкенде, см. payments.service.ts).
 */
export default function ReceiptDropzone({ file, onChange, hint, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f: File | null | undefined) => {
    onChange(f || null);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="form-group">
      <label>Чек / квитанция</label>
      {file ? (
        <div className="receipt-dropzone-preview">
          {preview ? (
            <img src={preview} alt="" />
          ) : (
            <Icon name="picture_as_pdf" size={32} style={{ color: 'var(--danger)' }} />
          )}
          <div className="receipt-dropzone-filename" title={file.name}>{file.name}</div>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => { pick(null); if (inputRef.current) inputRef.current.value = ''; }}
            title="Убрать файл"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : (
        <div
          className={`receipt-dropzone-btn${dragOver ? ' drag-over' : ''}${error ? ' has-error' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Icon name="upload_file" size={24} />
          <span>Перетащите файл сюда или нажмите, чтобы выбрать</span>
          <span className="receipt-dropzone-formats">Фото (JPG/PNG/WEBP/HEIC) или PDF, до 20 МБ</span>
        </div>
      )}
      {hint && <div className="receipt-dropzone-hint">{hint}</div>}
      {error && <div className="form-error-text">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_ACCEPT}
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
