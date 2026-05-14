import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createProgram, deleteProgram, listPrograms, programImageUrl, updateProgram, uploadProgramImage, type Program } from '../api/programs';
import type { Direction } from '../api/types';
import { DIRECTION_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import DirectionOptions from '../components/DirectionOptions';
import { compose, hasErrors, maxLen, minLen, positive, required, validateAll } from '../utils/validators';
import { useUrlFilter } from '../hooks/useUrlFilter';

// Дефолты фильтров вынесены за компонент — иначе useMemo на каждом рендере
// создавал бы новую ссылку и URL-хук триггерился без причины.
const PROGRAMS_FILTER_DEFAULTS = { city: '', major: '', direction: '' };

const emptyForm: Partial<Program> = {
  name: '',
  university: '',
  city: '',
  major: '',
  direction: 'BACHELOR',
  cost: 0,
  currency: 'CNY',
  duration: '',
  language: '',
  description: '',
  published: true,
};

export default function Programs() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = isPrivileged(me?.role);
  const [items, setItems] = useState<Program[]>([]);
  // Фильтры — в URL, чтобы при возврате назад они восстанавливались.
  const [filters, setFilter] = useUrlFilter(PROGRAMS_FILTER_DEFAULTS);
  const city = filters.city;
  const major = filters.major;
  const direction = filters.direction as Direction | '';
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Program> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    };
  }, [pendingPreview]);

  const openCreate = () => {
    setPendingImage(null);
    setPendingPreview(null);
    setEditing({ ...emptyForm });
  };

  const closeEditor = () => {
    setEditing(null);
    setPendingImage(null);
    if (pendingPreview) {
      URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
    }
  };

  const load = () => {
    setLoading(true);
    listPrograms({
      city: city || undefined,
      major: major || undefined,
      direction: direction || undefined,
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [city, major, direction]);

  useRealtime({
    'program:new': () => load(),
    'program:updated': () => load(),
    'program:deleted': () => load(),
  });

  const formErrors = editing
    ? validateAll(
        {
          name: editing.name || '',
          university: editing.university || '',
          city: editing.city || '',
          major: editing.major || '',
          cost: editing.cost ?? '',
        },
        {
          name: compose(required('Введите название'), minLen(2), maxLen(200)),
          university: compose(required('Введите университет'), minLen(2), maxLen(200)),
          city: compose(required('Укажите город'), minLen(2), maxLen(100)),
          major: compose(required('Укажите специальность'), minLen(2), maxLen(200)),
          cost: compose(required('Укажите стоимость'), positive('Стоимость должна быть больше 0')),
        },
      )
    : {};
  const formInvalid = hasErrors(formErrors);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || formInvalid) return;
    setSaving(true);
    try {
      const payload = {
        ...editing,
        cost: typeof editing.cost === 'string' ? parseFloat(editing.cost) : editing.cost,
      };
      if (editing.id) {
        await updateProgram(editing.id, payload);
        toast('Программа обновлена', 'success');
      } else {
        await createProgram(payload, pendingImage);
        toast('Программа создана', 'success');
      }
      closeEditor();
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onPickImage = (file: File) => {
    if (editing?.id) {
      // существующая программа — грузим сразу через отдельный endpoint
      onUploadImage(file);
    } else {
      // новая — держим в памяти, отправим вместе с создания
      setPendingImage(file);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(URL.createObjectURL(file));
    }
  };

  const onUploadImage = async (file: File) => {
    if (!editing?.id) {
      toast('Сначала сохраните программу, затем загрузите картинку', 'info');
      return;
    }
    setUploadingImage(true);
    try {
      const updated = await uploadProgramImage(editing.id, file);
      setEditing({ ...editing, imageUrl: updated.imageUrl });
      toast('Картинка загружена', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка загрузки', 'error');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const onDelete = async (p: Program) => {
    const ok = await confirm({
      title: 'Удалить программу',
      message: `«${p.name}» будет удалена. Студенты, привязанные к ней, останутся без программы.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProgram(p.id);
      toast('Программа удалена', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    }
  };

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="card-header">
        <h2 className="card-title">Программы обучения</h2>
        {isAdmin && (
          <motion.button
            className="btn btn-primary"
            onClick={openCreate}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            <Icon name="add" size={16} style={{ marginRight: 4 }} /> Новая программа
          </motion.button>
        )}
      </div>
      <div className="card-body">
        <div className="filters">
          <input placeholder="Город" value={city} onChange={(e) => setFilter('city', e.target.value)} />
          <input placeholder="Специальность" value={major} onChange={(e) => setFilter('major', e.target.value)} />
          <select value={direction} onChange={(e) => setFilter('direction', e.target.value)}>
            <option value="">Все направления</option>
            <DirectionOptions />
          </select>
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="l" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : items.length === 0 ? (
            <motion.div key="e" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="school" size={48} /></div>
              Программ пока нет
            </motion.div>
          ) : (
            <motion.div key="g" className="programs-grid" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
              {items.map((p) => (
                <motion.div
                  key={p.id}
                  className={`program-card${!p.published ? ' unpublished' : ''}`}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  whileHover={{ y: -4 }}
                >
                  {p.imageUrl && (
                    <div className="program-card-img">
                      <img src={programImageUrl(p.imageUrl)!} alt="" />
                    </div>
                  )}
                  <div className="program-card-head">
                    <div>
                      <div className="program-card-name">{p.name}</div>
                      <div className="program-card-uni">{p.university}</div>
                    </div>
                    {isAdmin && (
                      <div className="program-card-actions">
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ ...p })}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(p)}>
                          <Icon name="delete" size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="program-card-meta">
                    <span><Icon name="location_on" size={14} /> {p.city}</span>
                    <span><Icon name="menu_book" size={14} /> {DIRECTION_LABEL[p.direction]}</span>
                    <span><Icon name="school" size={14} /> {p.major}</span>
                    {p.duration && <span><Icon name="schedule" size={14} /> {p.duration}</span>}
                    {p.language && <span><Icon name="translate" size={14} /> {p.language}</span>}
                  </div>
                  <div className="program-card-cost">
                    {p.cost.toLocaleString('ru-RU')} {p.currency} <span>/ год</span>
                  </div>
                  {!p.published && <div className="program-card-draft">Скрыто на лендинге</div>}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Модалка редактирования */}
      <AnimatePresence>
        {editing && (
          <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !saving && closeEditor()}>
            <motion.form
              className="dialog-card"
              style={{ maxWidth: 640, textAlign: 'left' }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={onSave}
            >
              <div className="dialog-title" style={{ textAlign: 'left', marginBottom: 14 }}>
                {editing.id ? 'Редактировать программу' : 'Новая программа'}
              </div>
              <div className="form-group">
                <label>Название программы *</label>
                <input
                  value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={formErrors.name ? 'input-error' : ''}
                  maxLength={200}
                  required
                />
                {formErrors.name && <div className="form-error-text">{formErrors.name}</div>}
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Университет *</label>
                  <input
                    value={editing.university || ''}
                    onChange={(e) => setEditing({ ...editing, university: e.target.value })}
                    className={formErrors.university ? 'input-error' : ''}
                    maxLength={200}
                    required
                  />
                  {formErrors.university && <div className="form-error-text">{formErrors.university}</div>}
                </div>
                <div className="form-group">
                  <label>Город *</label>
                  <input
                    value={editing.city || ''}
                    onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                    className={formErrors.city ? 'input-error' : ''}
                    maxLength={100}
                    required
                  />
                  {formErrors.city && <div className="form-error-text">{formErrors.city}</div>}
                </div>
                <div className="form-group">
                  <label>Специальность *</label>
                  <input
                    value={editing.major || ''}
                    onChange={(e) => setEditing({ ...editing, major: e.target.value })}
                    className={formErrors.major ? 'input-error' : ''}
                    maxLength={200}
                    required
                  />
                  {formErrors.major && <div className="form-error-text">{formErrors.major}</div>}
                </div>
                <div className="form-group">
                  <label>Направление *</label>
                  <select value={editing.direction} onChange={(e) => setEditing({ ...editing, direction: e.target.value as Direction })}>
                    <DirectionOptions />
                  </select>
                </div>
                <div className="form-group">
                  <label>Стоимость / год *</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={editing.cost as any || ''}
                    onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) })}
                    className={formErrors.cost ? 'input-error' : ''}
                    required
                  />
                  {formErrors.cost && <div className="form-error-text">{formErrors.cost}</div>}
                </div>
                <div className="form-group">
                  <label>Валюта</label>
                  <select value={editing.currency || 'CNY'} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}>
                    <option value="CNY">CNY (юань)</option>
                    <option value="USD">USD</option>
                    <option value="RUB">RUB</option>
                    <option value="TJS">TJS</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Длительность</label>
                  <input value={editing.duration || ''} placeholder="4 года" onChange={(e) => setEditing({ ...editing, duration: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Язык обучения</label>
                  <input value={editing.language || ''} placeholder="English / Chinese" onChange={(e) => setEditing({ ...editing, language: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea rows={4} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Картинка программы</label>
                <div className="program-image-uploader">
                  {(pendingPreview || editing.imageUrl) && (
                    <div className="program-image-preview">
                      <img
                        src={pendingPreview || programImageUrl(editing.imageUrl)!}
                        alt=""
                      />
                    </div>
                  )}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickImage(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={uploadingImage}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <Icon name="image" size={16} style={{ marginRight: 6 }} />
                    {uploadingImage
                      ? 'Загружаем...'
                      : pendingPreview || editing.imageUrl
                        ? 'Заменить'
                        : 'Загрузить'}
                  </button>
                  {!editing.id && pendingImage && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                      Картинка отправится вместе с программой при сохранении.
                    </div>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
                  <input type="checkbox" checked={editing.published !== false} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />
                  Показывать на лендинге
                </label>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeEditor} disabled={saving}>Отмена</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || formInvalid}
                  title={formInvalid ? 'Исправьте ошибки в форме' : ''}
                >
                  {saving ? 'Сохраняем...' : 'Сохранить'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
