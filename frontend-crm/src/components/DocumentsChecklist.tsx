import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Document } from '../api/types';
import { deleteDocument, uploadDocument } from '../api/students';
import { useUI } from '../ui/Dialogs';
import { buildFileUrl } from '../utils/fileUrl';
import Icon from '../Icon';

export const REQUIRED_DOCUMENTS: { type: string; label: string; hint?: string }[] = [
  { type: 'PHOTO', label: 'Фото 3/4', hint: 'В электронном формате' },
  { type: 'PASSPORT', label: 'Загран паспорт' },
  { type: 'BANK', label: 'Справка с банка' },
  { type: 'MEDICAL', label: 'Мед.справка (для Китая)' },
  { type: 'NO_CRIMINAL', label: 'Справка о несудимости' },
  { type: 'STUDY_PLAN', label: 'Study Plan (Мотивационное письмо)' },
  { type: 'CERTIFICATE', label: 'Certificate', hint: 'IELTS, TOEFL, DUOLINGO, HSK, CSCA (если есть)' },
  { type: 'PARENTS_PASSPORT', label: 'Паспорт родителей' },
  { type: 'DIPLOMA', label: 'Аттестат', hint: 'Или табель оценок + справка со школы' },
  { type: 'RECOMMENDATION', label: 'Рекомендательное письмо' },
  // 12.08.2026 — зеркало backend/src/common/documents.ts. Приглашение готовит
  // университет, загружает менеджер; студент его скачивает для визы.
  { type: 'INVITATION', label: 'Приглашение из университета', hint: 'Загружает менеджер — нужно для визы' },
];

/**
 * ТЗ v3 раздел 2, критерий приёмки (решение заказчика): до 15 файлов ЗА ОДНУ
 * загрузку. Ограничение на порцию, а не на студента — общее количество
 * документов не ограничено, следующие пятнадцать грузятся следующим выбором.
 * Причина границы прозаична: файлы уходят последовательно, и пачка из ста
 * штук выглядела бы как намертво зависший интерфейс.
 */
const MAX_UPLOAD_FILES = 15;

/**
 * ТЗ v3 раздел 2 — форматы документов студента: PDF, JPG, PNG, WEBP, HEIC, DOCX.
 * Указываем и MIME, и расширения: HEIC с iPhone часть браузеров отдаёт с пустым
 * type, и по одному MIME диалог выбора такие файлы просто не покажет.
 *
 * Раздел «Прочие документы» пользуется своим, более широким списком — там
 * разрешены ещё и видео-презентации.
 */
const DOC_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

type Props = {
  studentId: string;
  studentName?: string;
  documents: Document[];
  applicationForm?: any;
  onChange: () => void;
  editable: boolean;
};

const sanitizeFileName = (s: string) =>
  s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);

export default function DocumentsChecklist({ studentId, studentName, documents, applicationForm, onChange, editable }: Props) {
  const { confirm, toast } = useUI();
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  /** Счётчик «загружено N из M» — файлы уходят последовательно, без него пачка выглядит как зависание. */
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [zipping, setZipping] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const otherRef = useRef<HTMLInputElement>(null);

  const typedDocs = documents.filter((d) => d.type && d.type !== 'OTHER');
  const otherDocs = documents.filter((d) => !d.type || d.type === 'OTHER');
  const uploadedCount = REQUIRED_DOCUMENTS.filter((r) =>
    typedDocs.some((d) => d.type === r.type),
  ).length;
  const total = REQUIRED_DOCUMENTS.length;
  const percent = Math.round((uploadedCount / total) * 100);

  /**
   * ТЗ v3 раздел 2 — «предварительный просмотр списка прикреплённых файлов
   * ПЕРЕД СОХРАНЕНИЕМ с кнопкой удаления конкретного файла».
   *
   * Раньше выбор файла означал немедленную отправку: ошибиться и передумать
   * было негде, «удалить» означало удалить уже загруженный документ. Теперь
   * выбранные файлы сначала попадают сюда, менеджер видит список, может
   * выкинуть лишнее, и только потом нажимает «Загрузить».
   *
   * Одна область на весь чек-лист, а не по одной на каждый из десяти типов:
   * выбрать файлы сразу в двух слотах физически нельзя (диалог модальный), а
   * десять независимых состояний означали бы десять способов забыть про
   * незавершённый выбор.
   */
  const [pending, setPending] = useState<{ type: string; files: File[] } | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const files = Array.from(e.target.files || []);
    // Сбрасываем значение СРАЗУ: иначе повторный выбор того же файла (например
    // после того, как его выкинули из списка) не вызвал бы onChange вовсе.
    e.target.value = '';
    if (files.length === 0) return;

    // Проверки делаем ДО показа списка — бессмысленно давать вычёркивать файлы
    // из набора, который целиком не будет принят.
    if (files.length > MAX_UPLOAD_FILES) {
      toast(
        `За один раз можно загрузить не более ${MAX_UPLOAD_FILES} файлов — выбрано ${files.length}. Загрузите их в несколько приёмов.`,
        'error',
      );
      return;
    }
    if (type === 'OTHER') {
      const MAX_OTHER_BYTES = 100 * 1024 * 1024;
      const tooBig = files.find((f) => f.size > MAX_OTHER_BYTES);
      if (tooBig) {
        toast(
          `Файл "${tooBig.name}" слишком большой (${(tooBig.size / 1024 / 1024).toFixed(1)} МБ). Максимум: 100 МБ.`,
          'error',
        );
        return;
      }
    }

    // Добавляем к уже выбранным, если это тот же слот: менеджер может набирать
    // документы из разных папок. Дубликаты по имени+размеру отсекаем — иначе
    // один и тот же паспорт легко уходит на сервер дважды.
    setPending((prev) => {
      const base = prev && prev.type === type ? prev.files : [];
      const seen = new Set(base.map((f) => `${f.name}:${f.size}`));
      const merged = [...base];
      for (const f of files) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) { seen.add(key); merged.push(f); }
      }
      return { type, files: merged.slice(0, MAX_UPLOAD_FILES) };
    });
  };

  /** Выкинуть один файл из ещё не отправленного набора (кнопка ✕ в списке). */
  const removePending = (index: number) => {
    setPending((prev) => {
      if (!prev) return prev;
      const files = prev.files.filter((_, i) => i !== index);
      return files.length ? { ...prev, files } : null;
    });
  };

  /**
   * Отправка уже подтверждённого набора. Проверки количества и размера
   * остались на шаге выбора (onPick) — здесь набор заведомо валидный.
   */
  const handleUpload = async (files: File[], type: string) => {
    if (files.length === 0) return;

    setUploadingType(type);
    setUploadProgress({ done: 0, total: files.length });

    // Отказ одного файла больше не отменяет остальные. Раньше цикл падал на
    // первой ошибке, и менеджер не знал, что часть документов всё же легла:
    // повторная загрузка «всей пачки» плодила дубликаты. Копим неудачные и
    // показываем их списком — так видно, что именно нужно перевыбрать.
    const failed: string[] = [];
    let firstError = '';
    for (const file of files) {
      try {
        await uploadDocument(studentId, file, type);
      } catch (err: any) {
        failed.push(file.name);
        if (!firstError) firstError = err?.response?.data?.message || '';
      }
      setUploadProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }

    setUploadingType(null);
    setUploadProgress(null);

    // Список перечитываем, если легло хоть что-то — иначе успешно загруженные
    // файлы не появились бы в чек-листе до перезагрузки страницы.
    if (failed.length < files.length) onChange();

    if (failed.length === 0) {
      // Набор ушёл целиком — область выбора больше не нужна.
      setPending(null);
      toast(files.length > 1 ? `Загружено: ${files.length}` : 'Документ загружен', 'success');
    } else {
      // Оставляем в области выбора ТОЛЬКО неудачные: успешные уже на сервере,
      // и повторная отправка всего набора создала бы дубликаты — ровно та
      // ошибка, из-за которой раньше в карточке появлялось по два паспорта.
      setPending({ type, files: files.filter((f) => failed.includes(f.name)) });
      toast(
        `Не удалось загрузить (${failed.length} из ${files.length}): ${failed.join(', ')}${firstError ? ` — ${firstError}` : ''}`,
        'error',
      );
    }
  };

  /**
   * ТЗ v3 раздел 2 — список выбранных, но ещё НЕ отправленных файлов.
   * Рисуется прямо под кнопкой того слота, куда их выбрали, чтобы не гадать,
   * к какому документу относится набор.
   */
  const renderPending = (type: string) => {
    if (!pending || pending.type !== type) return null;
    const busy = uploadingType === type;
    return (
      <div className="doc-pending">
        <div className="doc-pending-head">
          Выбрано файлов: {pending.files.length} из {MAX_UPLOAD_FILES}
        </div>
        <div className="doc-pending-list">
          {pending.files.map((f, i) => (
            <div key={`${f.name}:${f.size}:${i}`} className="doc-pending-item">
              <Icon name={f.type.startsWith('image/') ? 'image' : 'description'} size={16} />
              <span className="doc-pending-name" title={f.name}>{f.name}</span>
              <span className="doc-pending-size">{fmtBytes(f.size)}</span>
              <button
                type="button"
                className="doc-pending-del"
                title="Убрать файл"
                onClick={() => removePending(i)}
                disabled={busy}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="doc-pending-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => handleUpload(pending.files, type)}
            disabled={busy}
          >
            <Icon name={busy ? 'progress_activity' : 'cloud_upload'} size={15} style={{ marginRight: 4 }} />
            {busy ? uploadingLabel() : `Загрузить (${pending.files.length})`}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setPending(null)} disabled={busy}>
            Отмена
          </button>
        </div>
      </div>
    );
  };

  /** «Загрузка 3 из 15…» вместо безликого «Загрузка...» — файлы идут последовательно и долго. */
  const uploadingLabel = () =>
    uploadProgress && uploadProgress.total > 1
      ? `Загрузка ${Math.min(uploadProgress.done + 1, uploadProgress.total)} из ${uploadProgress.total}…`
      : 'Загрузка...';

  const handleDownloadZip = async () => {
    if (documents.length === 0 && !applicationForm) return;
    setZipping(true);
    try {
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ]);
      const zip = new JSZip();
      // Файлы, которые не удалось скачать (сеть/401/404) — покажем пользователю,
      // а не пропустим молча. Иначе он получит неполный архив и не узнает об этом.
      const failedFiles: string[] = [];
      let downloadedCount = 0;

      // Сначала — анкета в формате Word (если хоть что-то заполнено или даже пустая)
      if (applicationForm) {
        try {
          const { generateStudentFormDocx } = await import('../utils/studentFormDocx');
          const formBlob = await generateStudentFormDocx(studentName || 'Student', applicationForm);
          zip.file('00_Анкета_Студента.docx', formBlob);
        } catch (err) {
          console.error('Failed to generate form docx:', err);
        }
      }

      // Загружаем типизированные документы (несколько файлов в категории идут с суффиксом _1/_2/...)
      for (let i = 0; i < REQUIRED_DOCUMENTS.length; i++) {
        const req = REQUIRED_DOCUMENTS[i];
        const docs = typedDocs.filter((d) => d.type === req.type);
        if (docs.length === 0) continue;
        for (let j = 0; j < docs.length; j++) {
          const doc = docs[j];
          try {
            // /uploads теперь требует авторизацию — без credentials backend
            // ответит 401, и файл был бы молча пропущен.
            const res = await fetch(buildFileUrl(doc.url), { credentials: 'include' });
            if (!res.ok) {
              failedFiles.push(doc.originalName);
              continue;
            }
            const blob = await res.blob();
            const ext = doc.originalName.includes('.') ? doc.originalName.split('.').pop() : '';
            const baseName = `${String(i + 1).padStart(2, '0')}_${sanitizeFileName(req.label)}${docs.length > 1 ? `_${j + 1}` : ''}`;
            const fileName = ext ? `${baseName}.${ext}` : baseName;
            zip.file(fileName, blob);
            downloadedCount++;
          } catch {
            failedFiles.push(doc.originalName);
          }
        }
      }

      // Прочие документы — в папке "Прочее"
      if (otherDocs.length > 0) {
        const otherFolder = zip.folder('Прочее');
        for (const doc of otherDocs) {
          try {
            const res = await fetch(buildFileUrl(doc.url), { credentials: 'include' });
            if (!res.ok) {
              failedFiles.push(doc.originalName);
              continue;
            }
            const blob = await res.blob();
            otherFolder?.file(sanitizeFileName(doc.originalName), blob);
            downloadedCount++;
          } catch {
            failedFiles.push(doc.originalName);
          }
        }
      }

      // Если ни один файл не скачался — архив бессмысленен (в лучшем случае
      // там будет только анкета), сообщаем об ошибке и не сохраняем ZIP.
      if (downloadedCount === 0 && (typedDocs.length > 0 || otherDocs.length > 0)) {
        toast('Не удалось скачать ни одного файла. Попробуйте ещё раз.', 'error');
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const date = new Date().toISOString().slice(0, 10);
      const safeName = sanitizeFileName(studentName || 'student');
      saveAs(blob, `${safeName}_документы_${date}.zip`);

      if (failedFiles.length > 0) {
        toast(
          `Архив скачан, но ${failedFiles.length} файл(ов) не удалось загрузить: ${failedFiles.join(', ')}`,
          'error',
        );
      } else {
        toast('Архив скачан', 'success');
      }
    } catch (e: any) {
      toast(e?.message || 'Ошибка создания архива', 'error');
    } finally {
      setZipping(false);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="docs-progress-percent">{percent}%</span>
            <motion.button
              className="btn btn-sm btn-secondary"
              onClick={handleDownloadZip}
              disabled={zipping || documents.length === 0}
              whileHover={!zipping && documents.length > 0 ? { scale: 1.04 } : {}}
              whileTap={{ scale: 0.96 }}
              title={
                documents.length === 0
                  ? 'Нет документов для скачивания'
                  : 'Скачать все файлы одним архивом'
              }
              style={documents.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              <Icon name={zipping ? 'progress_activity' : 'folder_zip'} size={16} style={{ marginRight: 4 }} />
              {zipping ? 'Архивируем…' : `Скачать ZIP (${documents.length})`}
            </motion.button>
          </div>
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
          const docs = typedDocs.filter((d) => d.type === req.type);
          const isUploaded = docs.length > 0;
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
                  <div className="doc-slot-label">
                    {req.label}
                    {docs.length > 1 && <span className="doc-slot-count"> · {docs.length} файла</span>}
                  </div>
                  {req.hint && <div className="doc-slot-hint">{req.hint}</div>}
                </div>
              </div>

              {isUploaded ? (
                <>
                  <div className="doc-slot-files">
                    {docs.map((doc) => (
                      <div key={doc.id} className="doc-slot-file">
                        <a href={buildFileUrl(doc.url)} target="_blank" rel="noreferrer" className="doc-slot-filename">
                          <Icon name="description" size={18} />
                          <span>{doc.originalName}</span>
                        </a>
                        <div className="doc-slot-meta">
                          {fmtBytes(doc.size)} · {new Date(doc.createdAt).toLocaleDateString('ru-RU')}
                        </div>
                        {editable && (
                          <button className="btn btn-sm btn-danger doc-slot-del" onClick={() => handleDelete(doc)}>
                            <Icon name="delete" size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {editable && (
                    <button
                      className="btn btn-sm btn-secondary doc-slot-add"
                      onClick={() => inputRefs.current[req.type]?.click()}
                      disabled={isUploading}
                    >
                      <Icon name={isUploading ? 'progress_activity' : 'add'} size={16} style={{ marginRight: 4 }} />
                      {isUploading ? uploadingLabel() : 'Добавить ещё'}
                    </button>
                  )}
                </>
              ) : editable ? (
                <button
                  className="btn btn-secondary doc-slot-upload"
                  onClick={() => inputRefs.current[req.type]?.click()}
                  disabled={isUploading}
                >
                  <Icon name={isUploading ? 'progress_activity' : 'upload'} size={18} style={{ marginRight: 6 }} />
                  {isUploading ? uploadingLabel() : 'Загрузить'}
                </button>
              ) : (
                <div className="doc-slot-empty">Не загружено</div>
              )}

              <input
                ref={(el) => { inputRefs.current[req.type] = el; }}
                type="file"
                multiple
                accept={DOC_ACCEPT}
                hidden
                onChange={(e) => onPick(e, req.type)}
              />

              {renderPending(req.type)}
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
                    <a href={buildFileUrl(d.url)} target="_blank" rel="noreferrer" style={{ color: '#d52b2b' }}>
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
              disabled={uploadingType === 'OTHER'}
            >
              <Icon
                name={uploadingType === 'OTHER' ? 'progress_activity' : 'attach_file'}
                size={16}
                style={{ marginRight: 4 }}
              />
              {uploadingType === 'OTHER' ? uploadingLabel() : 'Загрузить другие документы'}
            </button>
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: 'var(--text-soft, #5b6478)',
                lineHeight: 1.45,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <Icon
                name="info"
                size={14}
                style={{ marginTop: 2, color: 'var(--primary, #d52b2b)' }}
              />
              <span>
                Можно загрузить <b>видео-презентацию студента</b> (mp4, mov, webm) или любой
                другой документ. <b>Максимум 100 МБ</b> на файл, до <b>{MAX_UPLOAD_FILES} файлов</b> за раз —
                выделяйте сразу несколько.
              </span>
            </div>
            {/* multiple по ТЗ v3 раздел 2. У обязательных типов выше он был
                изначально, а «Прочие документы» — единственный блок, где файлы
                грузились строго по одному: чтобы приложить пять справок,
                менеджеру приходилось пять раз открывать диалог выбора. */}
            <input
              ref={otherRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/webm,video/*,image/*,application/pdf,.doc,.docx"
              hidden
              onChange={(e) => onPick(e, 'OTHER')}
            />

            {renderPending('OTHER')}
          </div>
        )}
      </div>
    </div>
  );
}
