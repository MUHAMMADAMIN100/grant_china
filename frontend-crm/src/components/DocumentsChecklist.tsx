import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Document } from '../api/types';
import { deleteDocument, uploadDocument } from '../api/students';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

const API_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '');

export const REQUIRED_DOCUMENTS: { type: string; label: string; hint?: string }[] = [
  { type: 'PHOTO', label: 'Фото 3/4', hint: 'В электронном формате' },
  { type: 'PASSPORT', label: 'Загран паспорт' },
  { type: 'BANK', label: 'Справка с банка' },
  { type: 'MEDICAL', label: 'Мед.справка (для Китая)' },
  { type: 'NO_CRIMINAL', label: 'Справка о несудимости' },
  { type: 'STUDY_PLAN', label: 'Study Plan' },
  { type: 'CERTIFICATE', label: 'Certificate' },
  { type: 'PARENTS_PASSPORT', label: 'Parents passport' },
  { type: 'DIPLOMA', label: 'Аттестат', hint: 'Или табель оценок + справка со школы' },
  { type: 'RECOMMENDATION', label: 'Рекомендательное письмо' },
];

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

type Props = {
  studentId: string;
  documents: Document[];
  onChange: () => void;
  editable: boolean;
};

export default function DocumentsChecklist({ studentId, documents, onChange, editable }: Props) {
  const { confirm, toast } = useUI();
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const otherRef = useRef<HTMLInputElement>(null);

  const typedDocs = documents.filter((d) => d.type && d.type !== 'OTHER');
  const otherDocs = documents.filter((d) => !d.type || d.type === 'OTHER');
  const uploadedCount = REQUIRED_DOCUMENTS.filter((r) =>
    typedDocs.some((d) => d.type === r.type),
  ).length;
  const total = REQUIRED_DOCUMENTS.length;
  const percent = Math.round((uploadedCount / total) * 100);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingType(type);
    try {
      await uploadDocument(studentId, file, type);
      toast('Документ загружен', 'success');
      onChange();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка загрузки', 'error');
    } finally {
      setUploadingType(null);
      e.target.value = '';
    }
  };

  const handleDelete = async (doc: Document) => {
    const ok = await confirm({
      title: 'Удалить документ',
      message: `«${doc.originalName}» будет удалён безвозвратно.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    await deleteDocument(doc.id);
    toast('Документ удалён', 'success');
    onChange();
  };

  return (
    <div className="docs-checklist">
      <div className="docs-info">
        <Icon name="info" size={20} />
        <div>
          Все документы необходимо <b>перевести на английский язык</b> и <b>нотариально заверить</b>.
        </div>
      </div>

      <div className="docs-progress">
        <div className="docs-progress-text">
          <span>Загружено <b>{uploadedCount}</b> из {total}</span>
          <span className="docs-progress-percent">{percent}%</span>
        </div>
        <div className="docs-progress-bar">
          <motion.div
            className="docs-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="docs-grid">
        {REQUIRED_DOCUMENTS.map((req) => {
          const doc = typedDocs.find((d) => d.type === req.type);
          const isUploaded = !!doc;
          const isUploading = uploadingType === req.type;

          return (
            <motion.div
              key={req.type}
              className={`doc-slot${isUploaded ? ' uploaded' : ''}`}
              layout
            >
              <div className="doc-slot-header">
                <div className={`doc-slot-status ${isUploaded ? 'ok' : 'missing'}`}>
                  <Icon name={isUploaded ? 'check_circle' : 'radio_button_unchecked'} size={22} />
                </div>
                <div className="doc-slot-info">
                  <div className="doc-slot-label">{req.label}</div>
                  {req.hint && <div className="doc-slot-hint">{req.hint}</div>}
                </div>
              </div>

              {isUploaded && doc ? (
                <div className="doc-slot-file">
                  <a href={`${API_BASE}${doc.url}`} target="_blank" rel="noreferrer" className="doc-slot-filename">
                    <Icon name="description" size={18} />
                    <span>{doc.originalName}</span>
                  </a>
                  <div className="doc-slot-meta">
                    {fmtBytes(doc.size)} · {new Date(doc.createdAt).toLocaleDateString('ru-RU')}
                  </div>
                  {editable && (
                    <div className="doc-slot-actions">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => inputRefs.current[req.type]?.click()}
                        disabled={isUploading}
                      >
                        <Icon name="refresh" size={16} style={{ marginRight: 4 }} />
                        Заменить
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(doc)}>
                        <Icon name="delete" size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ) : editable ? (
                <button
                  className="btn btn-secondary doc-slot-upload"
                  onClick={() => inputRefs.current[req.type]?.click()}
                  disabled={isUploading}
                >
                  <Icon name={isUploading ? 'progress_activity' : 'upload'} size={18} style={{ marginRight: 6 }} />
                  {isUploading ? 'Загрузка...' : 'Загрузить'}
                </button>
              ) : (
                <div className="doc-slot-empty">Не загружено</div>
              )}

              <input
                ref={(el) => { inputRefs.current[req.type] = el; }}
                type="file"
                hidden
                onChange={(e) => handleUpload(e, req.type)}
              />
            </motion.div>
          );
        })}
      </div>

      {/* Прочие документы */}
      <div className="docs-other-section">
        <h4 className="docs-other-title">Прочие документы</h4>
        {otherDocs.length === 0 ? (
          <div className="empty" style={{ padding: 16 }}>Прочих документов нет</div>
        ) : (
          <div className="documents-list">
            {otherDocs.map((d) => (
              <div key={d.id} className="doc-item">
                <span className="doc-icon"><Icon name="description" size={20} /></span>
                <div className="doc-info">
                  <div className="doc-name">
                    <a href={`${API_BASE}${d.url}`} target="_blank" rel="noreferrer" style={{ color: '#d52b2b' }}>
                      {d.originalName}
                    </a>
                  </div>
                  <div className="doc-size">{fmtBytes(d.size)} · {new Date(d.createdAt).toLocaleDateString('ru-RU')}</div>
                </div>
                {editable && (
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d)}>Удалить</button>
                )}
              </div>
            ))}
          </div>
        )}
        {editable && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => otherRef.current?.click()}
            >
              <Icon name="attach_file" size={16} style={{ marginRight: 4 }} />
              Загрузить другой документ
            </button>
            <input
              ref={otherRef}
              type="file"
              hidden
              onChange={(e) => handleUpload(e, 'OTHER')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
