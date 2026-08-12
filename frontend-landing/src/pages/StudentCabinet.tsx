import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  API_BASE,
  buildFileUrl,
  studentDeleteDocument,
  studentLogout,
  studentMe,
  studentUploadDocument,
  studentUploadPhoto,
  type StudentMe,
} from '../studentApi';
import { connectStudentRealtime, useStudentRealtime, getSocket } from '../realtime';
import ApplicationFormSection from '../components/ApplicationFormSection';
import EnrollmentProgress from '../components/EnrollmentProgress';
import ProgramsSection from '../components/ProgramsSection';
import Icon from '../Icon';

const DIRECTION_LABEL: Record<string, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Активный',
  PAUSED: 'На паузе',
  GRADUATED: 'Выпустился',
  ARCHIVED: 'В архиве',
};

/**
 * Раздел 5 ТЗ — индикатор статуса визы в личном кабинете.
 *
 * Оформлен «кнопкой» (пилюля с иконкой), как просил заказчик, но НЕ является
 * кнопкой в разметке: студент статус визы не меняет — его переключает менеджер
 * в CRM. Ставить сюда <button>, который ничего не делает (или делает 403),
 * значит обманывать и мышь, и скринридер, поэтому это <div role="status">.
 *
 * Цвета инлайном, а не классами в index.css: индикатор существует ровно
 * в одном месте кабинета, и держать его правила рядом с разметкой честнее,
 * чем плодить в общем файле стилей пару классов на один компонент.
 */
const VISA_STYLE = {
  yes: { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' },
  no: { background: '#f9fafb', color: '#4b5563', border: '1px solid #e5e7eb' },
} as const;

const REQUIRED_DOCS = [
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
];

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

export default function StudentCabinet() {
  const navigate = useNavigate();
  const [me, setMe] = useState<StudentMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<'home' | 'programs'>('home');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const otherRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    // Проверка авторизации теперь через GET /me (cookie); первый load()
    // словит 401 если cookie мёртвая — там и редирект на /login.
    if (!getSocket()) connectStudentRealtime();
    load(true); // первый заход — показать спиннер
  }, []);

  useStudentRealtime({
    'student:updated': () => load(),
    'document:uploaded': () => load(),
    'document:deleted': () => load(),
    'application:updated': () => load(),
  });

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await studentMe();
      setMe(data);
    } catch {
      // Cookie мёртвая / 401 — logout очистит её и редиректнем
      await studentLogout();
      navigate('/login', { replace: true });
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  const logout = async () => {
    await studentLogout();
    navigate('/login');
  };

  /** Смена фото профиля. Новый URL применяем сразу из ответа, не дожидаясь load(). */
  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('err', 'Фото должно быть изображением (JPG, PNG…)');
      return;
    }
    setPhotoUploading(true);
    try {
      const { photoUrl } = await studentUploadPhoto(file);
      setMe((prev) => (prev ? { ...prev, photoUrl } : prev));
      showToast('ok', 'Фото обновлено');
    } catch (err: any) {
      showToast('err', err?.response?.data?.message || 'Не удалось загрузить фото');
    } finally {
      setPhotoUploading(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Раздел "Другие файлы" допускает видео-презентации, поэтому ограничиваем
    // размер каждого файла 100 МБ (в backend MAX_FILE_SIZE 200 МБ — это
    // дополнительная клиентская граница чтобы юзер сразу видел ошибку, а не
    // ждал минуты загрузки впустую).
    if (type === 'OTHER') {
      const MAX_OTHER_BYTES = 100 * 1024 * 1024;
      const tooBig = files.find((f) => f.size > MAX_OTHER_BYTES);
      if (tooBig) {
        const sizeMb = (tooBig.size / 1024 / 1024).toFixed(1);
        showToast('err', `Файл "${tooBig.name}" слишком большой (${sizeMb} МБ). Максимум: 100 МБ.`);
        e.target.value = '';
        return;
      }
    }

    setUploading(type);
    // try/catch ВНУТРИ цикла, а не снаружи. Общий catch прерывал пачку на
    // первом сбое: уже загруженные файлы оставались на сервере, а студент
    // видел только «Ошибка загрузки» — повторный выбор той же пачки создавал
    // дубликаты. Теперь отказ одного файла не отменяет остальные, и в
    // сообщении видно, что именно нужно перевыбрать. Тот же приём, что в
    // DocumentsChecklist.tsx на стороне CRM.
    const failed: string[] = [];
    let firstError = '';
    for (const file of files) {
      try {
        await studentUploadDocument(file, type);
      } catch (err: any) {
        failed.push(file.name);
        if (!firstError) firstError = err?.response?.data?.message || '';
      }
    }
    setUploading(null);
    e.target.value = '';

    // Перечитываем, если легло хоть что-то — иначе успешные загрузки не
    // появились бы в кабинете до перезагрузки страницы.
    if (failed.length < files.length) await load();

    if (failed.length === 0) {
      showToast('ok', files.length > 1 ? `Загружено: ${files.length}` : 'Документ загружен');
    } else {
      showToast(
        'err',
        `Не удалось загрузить (${failed.length} из ${files.length}): ${failed.join(', ')}${firstError ? ` — ${firstError}` : ''}`,
      );
    }
  };

  const onDelete = async (docId: string) => {
    if (!confirm('Удалить документ?')) return;
    try {
      await studentDeleteDocument(docId);
      showToast('ok', 'Документ удалён');
      await load();
    } catch (err: any) {
      showToast('err', err?.response?.data?.message || 'Ошибка');
    }
  };

  if (loading || !me) {
    return <div className="stu-loading">Загрузка...</div>;
  }

  const typed = (me.documents || []).filter((d) => d.type && d.type !== 'OTHER');
  const other = (me.documents || []).filter((d) => !d.type || d.type === 'OTHER');
  const uploaded = REQUIRED_DOCS.filter((r) => typed.some((d) => d.type === r.type)).length;
  const percent = Math.round((uploaded / REQUIRED_DOCS.length) * 100);

  return (
    <div className="stu-page">
      <header className="stu-header">
        <div className="container stu-header-inner">
          <Link to="/" className="logo">
            <span className="brand-text" style={{ fontSize: 22 }}>
              <span className="brand-grant">GRANT</span>
              <span className="brand-china">CHINA</span>
            </span>
          </Link>
          <div className="stu-header-user">
            <div className="stu-header-name">{me.fullName}</div>
            <button className="btn btn-outline" onClick={logout}>
              <Icon name="logout" size={18} style={{ marginRight: 4 }} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="container stu-main">
        <div className="stu-tabs">
          <button
            type="button"
            className={`stu-tab${tab === 'home' ? ' active' : ''}`}
            onClick={() => setTab('home')}
          >
            <Icon name="dashboard" size={18} />
            Главная
          </button>
          <button
            type="button"
            className={`stu-tab${tab === 'programs' ? ' active' : ''}`}
            onClick={() => setTab('programs')}
          >
            <Icon name="menu_book" size={18} />
            Программы
          </button>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              className={`stu-toast stu-toast-${toast.kind}`}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Icon name={toast.kind === 'ok' ? 'check_circle' : 'error'} size={18} />
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>

        {tab === 'programs' ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ProgramsSection />
          </motion.div>
        ) : (
          <>
            {/* Поздравление при зачислении */}
            {me.applications?.[0]?.status === 'ENROLLED' && (
              <motion.div
                className="stu-celebrate"
                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 18 }}
              >
                <div className="stu-confetti" aria-hidden="true">
                  {Array.from({ length: 24 }).map((_, i) => {
                    const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
                    const left = Math.random() * 100;
                    const delay = Math.random() * 1.5;
                    const dur = 2 + Math.random() * 2;
                    const size = 6 + Math.random() * 8;
                    return (
                      <motion.span
                        key={i}
                        className="stu-confetti-piece"
                        style={{
                          left: `${left}%`,
                          width: size,
                          height: size,
                          background: colors[i % colors.length],
                        }}
                        initial={{ y: -20, opacity: 0, rotate: 0 }}
                        animate={{
                          y: 220,
                          opacity: [0, 1, 1, 0],
                          rotate: 360,
                        }}
                        transition={{
                          duration: dur,
                          delay,
                          repeat: Infinity,
                          ease: 'easeIn',
                        }}
                      />
                    );
                  })}
                </div>
                <motion.div
                  className="stu-celebrate-icon"
                  animate={{ rotate: [0, -10, 10, -10, 10, 0], scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                >
                  🎉
                </motion.div>
                <div>
                  <motion.div
                    className="stu-celebrate-title"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    Поздравляем с зачислением! 🎓
                  </motion.div>
                  <motion.div
                    className="stu-celebrate-sub"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    Вы официально зачислены в университет. Это огромный шаг — ваша мечта стала реальностью!
                    Менеджер свяжется с вами лично, чтобы обсудить следующие шаги.
                  </motion.div>
                </div>
              </motion.div>
            )}

            {/* Прогресс поступления */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <EnrollmentProgress
                currentStatus={me.applications?.[0]?.status}
              />
            </motion.div>
          </>
        )}

        {tab === 'home' && (<>
        {/* Профиль */}
        <motion.section
          className="stu-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="stu-profile">
            {/* Доработка 12.08.2026 — студент меняет фото сам. Вся зона фото —
                кнопка: и пустой силуэт, и текущий снимок кликабельны, подпись
                снизу проговаривает действие для тех, кто не догадается. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="stu-photo"
                onClick={() => photoRef.current?.click()}
                disabled={photoUploading}
                aria-label="Сменить фото профиля"
                title="Сменить фото профиля"
                style={{ cursor: 'pointer', border: 'none', padding: 0, position: 'relative', overflow: 'hidden' }}
              >
                {me.photoUrl ? (
                  <img src={buildFileUrl(me.photoUrl)} alt="" />
                ) : (
                  <Icon name="person" size={60} />
                )}
                {photoUploading && (
                  <span
                    style={{
                      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                      background: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Загрузка…
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                disabled={photoUploading}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  font: 'inherit', fontSize: 13, color: '#2563eb', display: 'inline-flex',
                  alignItems: 'center', gap: 4,
                }}
              >
                <Icon name="photo_camera" size={15} />
                {me.photoUrl ? 'Сменить фото' : 'Загрузить фото'}
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPhotoChange}
              />
            </div>
            <div className="stu-profile-info">
              <h1 className="stu-profile-name">{me.fullName}</h1>
              <div className="stu-badges">
                <span className="stu-badge">{DIRECTION_LABEL[me.direction]}</span>
                <span className="stu-badge">Кабинет №{me.cabinet}</span>
                <span className={`stu-badge stu-status-${me.status.toLowerCase()}`}>
                  {STATUS_LABEL[me.status]}
                </span>
              </div>
              <div className="stu-profile-grid">
                <div><span>Email:</span> <b>{me.email}</b></div>
                <div><span>Телефоны:</span> <b>{me.phones.join(', ') || '—'}</b></div>
              </div>

              {/* Раздел 5 ТЗ — текущий статус визы. Виден всегда, в обоих
                  состояниях: «виза ещё не получена» — такой же ответ на вопрос
                  студента, как и «получена». Показывать индикатор только при
                  «Да» означало бы, что отсутствие блока читается как ошибка
                  загрузки, а не как честное «пока нет». */}
              <div
                role="status"
                aria-label={me.visaReceived ? 'Виза получена' : 'Виза ещё не получена'}
                style={{
                  ...(me.visaReceived ? VISA_STYLE.yes : VISA_STYLE.no),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 14,
                  padding: '10px 16px',
                  borderRadius: 999,
                  maxWidth: '100%',
                }}
              >
                <Icon name={me.visaReceived ? 'verified' : 'schedule'} size={22} />
                <div style={{ lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {me.visaReceived ? 'Виза получена' : 'Виза ещё не получена'}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {me.visaReceived
                      ? me.visaReceivedAt
                        ? `Отмечено ${new Date(me.visaReceivedAt).toLocaleDateString('ru-RU')}`
                        : 'Подтверждено вашим менеджером'
                      : 'Менеджер отметит здесь, как только виза будет готова'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Менеджеры */}
        <motion.section
          className="stu-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <h2 className="stu-section-title">Ваши менеджеры</h2>
          <div className="stu-managers">
            <div className={`stu-manager-slot${!me.manager ? ' empty' : ''}`}>
              <div className="stu-manager-flag">🇹🇯 Таджикистан</div>
              <div className="stu-manager-name">
                {me.manager?.fullName || 'Ещё не назначен'}
              </div>
              {me.manager?.email && (
                <a href={`mailto:${me.manager.email}`} className="stu-manager-email">
                  <Icon name="mail" size={14} /> {me.manager.email}
                </a>
              )}
            </div>
            <div className={`stu-manager-slot${!me.chinaManager ? ' empty' : ''}`}>
              <div className="stu-manager-flag">🇨🇳 Китай</div>
              <div className="stu-manager-name">
                {me.chinaManager?.fullName || 'Ещё не назначен'}
              </div>
              {me.chinaManager?.email && (
                <a href={`mailto:${me.chinaManager.email}`} className="stu-manager-email">
                  <Icon name="mail" size={14} /> {me.chinaManager.email}
                </a>
              )}
            </div>
          </div>
        </motion.section>

        {/* Документы */}
        <motion.section
          className="stu-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <h2 className="stu-section-title">Документы</h2>

          <div className="stu-note">
            <Icon name="info" size={18} />
            <div>
              Все документы нужно <b>перевести на английский</b> и <b>нотариально заверить</b>.
              Загружайте в любом формате — менеджер проверит.
            </div>
          </div>

          <div className="stu-progress">
            <div className="stu-progress-text">
              <span>Загружено <b>{uploaded}</b> из {REQUIRED_DOCS.length}</span>
              <span className="stu-progress-percent">{percent}%</span>
            </div>
            <div className="stu-progress-bar">
              <motion.div
                className="stu-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          <div className="stu-docs-grid">
            {REQUIRED_DOCS.map((req) => {
              const docs = typed.filter((d) => d.type === req.type);
              const loading = uploading === req.type;
              const hasAny = docs.length > 0;
              return (
                <div key={req.type} className={`stu-doc${hasAny ? ' uploaded' : ''}`}>
                  <div className="stu-doc-head">
                    <Icon
                      name={hasAny ? 'check_circle' : 'radio_button_unchecked'}
                      size={20}
                      style={{ color: hasAny ? '#10b981' : '#9ca3af' }}
                    />
                    <div>
                      <div className="stu-doc-label">
                        {req.label}
                        {docs.length > 1 && <span style={{ color: '#9ca3af' }}> · {docs.length}</span>}
                      </div>
                      {req.hint && <div className="stu-doc-hint">{req.hint}</div>}
                    </div>
                  </div>
                  {hasAny ? (
                    <>
                      {docs.map((doc) => (
                        <div key={doc.id} className="stu-doc-file">
                          {doc.restricted ? (
                            // Мед. / банковская справка — просмотр запрещён.
                            // Показываем название без ссылки, с подсказкой.
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: '#6b7280',
                                cursor: 'not-allowed',
                              }}
                              title="Файл получен. Доступ к содержимому — только у менеджера."
                            >
                              <Icon name="lock" size={16} /> {doc.originalName}
                            </span>
                          ) : (
                            <a href={buildFileUrl(doc.url)} target="_blank" rel="noreferrer">
                              <Icon name="description" size={16} /> {doc.originalName}
                            </a>
                          )}
                          <div className="stu-doc-meta">
                            {fmtBytes(doc.size)} · {new Date(doc.createdAt).toLocaleDateString('ru-RU')}
                            {doc.restricted && (
                              <>
                                {' · '}
                                <span style={{ color: '#6b7280' }}>
                                  доступ у менеджера
                                </span>
                              </>
                            )}
                          </div>
                          <div className="stu-doc-actions">
                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => onDelete(doc.id)}
                            >
                              <Icon name="delete" size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="btn btn-outline btn-small stu-doc-add-more"
                        style={{ marginTop: 8 }}
                        onClick={() => inputs.current[req.type]?.click()}
                        disabled={loading}
                      >
                        <Icon name={loading ? 'progress_activity' : 'add'} size={14} />
                        {loading ? 'Загрузка...' : 'Добавить ещё'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-primary btn-small stu-doc-upload"
                      onClick={() => inputs.current[req.type]?.click()}
                      disabled={loading}
                    >
                      <Icon name={loading ? 'progress_activity' : 'upload'} size={16} />
                      {loading ? 'Загрузка...' : 'Загрузить'}
                    </button>
                  )}
                  <input
                    ref={(el) => { inputs.current[req.type] = el; }}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => onUpload(e, req.type)}
                  />
                </div>
              );
            })}
          </div>

          <div className="stu-other">
            <h3>Другие файлы</h3>
            {other.length === 0 ? (
              <div className="stu-empty">Пока нет других документов</div>
            ) : (
              <div className="stu-other-list">
                {other.map((d) => (
                  <div key={d.id} className="stu-other-item">
                    <a href={buildFileUrl(d.url)} target="_blank" rel="noreferrer">
                      <Icon name="description" size={16} /> {d.originalName}
                    </a>
                    <button className="btn btn-danger btn-small" onClick={() => onDelete(d.id)}>
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="btn btn-outline btn-small"
              style={{ marginTop: 10 }}
              onClick={() => otherRef.current?.click()}
              disabled={uploading === 'OTHER'}
            >
              <Icon name="attach_file" size={14} />{' '}
              {uploading === 'OTHER' ? 'Загрузка...' : 'Загрузить другой файл'}
            </button>
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: 'var(--text-soft)',
                lineHeight: 1.45,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <Icon name="info" size={14} style={{ marginTop: 2, color: 'var(--primary)' }} />
              <span>
                Можно загрузить <b>видео-презентацию о себе</b> (mp4, mov, webm) или любой другой
                документ. <b>Максимум 100 МБ</b> на файл.
              </span>
            </div>
            <input
              ref={otherRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*,image/*,application/pdf,.doc,.docx"
              hidden
              onChange={(e) => onUpload(e, 'OTHER')}
            />
          </div>
        </motion.section>

        {/* Анкета */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <ApplicationFormSection />
        </motion.div>
        </>)}
      </main>
    </div>
  );
}
