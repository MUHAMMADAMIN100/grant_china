import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  createKnowledgeArticle,
  deleteKnowledgeArticle,
  listKnowledge,
  listKnowledgeCategories,
  updateKnowledgeArticle,
  type KnowledgeArticle,
  type KnowledgeCategory,
} from '../api/knowledge';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { useRealtime } from '../realtime';
import { removeById, runOptimistic } from '../utils/optimistic';
import Icon from '../Icon';
import { fadeUp, staggerContainer } from '../motion';

/**
 * ТЗ 6.1 — база знаний компании. Она же источник контекста для AI-помощника:
 * ассистент отвечает ТОЛЬКО по опубликованным статьям этого раздела
 * (backend/src/knowledge/knowledge.service.ts → buildContext).
 *
 * Отсюда два следствия для интерфейса:
 *  1. Черновик — это статья, которую ассистент не увидит. Об этом написано
 *     прямо в редакторе, иначе «почему бот не знает про новый регламент»
 *     станет вечным вопросом.
 *  2. Редактирование доступно только Основателю и Администратору — правку
 *     режет бэкенд (@Roles), кнопки просто не показываем остальным.
 */
export default function Knowledge() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const canEdit = isPrivileged(me?.role);

  const defaults = useMemo(() => ({ search: '', category: '', drafts: '' }), []);
  const [filters, , setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const category = filters.category;
  const showDrafts = filters.drafts === '1';

  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [items, setItems] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editor, setEditor] = useState<KnowledgeArticle | 'new' | null>(null);

  const includeDrafts = canEdit && showDrafts;

  /**
   * silent — обновление ФОНОМ, без подмены списка на «Загрузка...».
   *
   * Нужно потому, что knowledge:updated сервер шлёт ВСЕМ сотрудникам, включая
   * автора правки: после собственного сохранения к нам возвращается эхо, и
   * если на него гасить список, статья, которую человек только что закрыл,
   * мигнёт «Загрузкой» на ровном месте. Полноэкранное ожидание оставляем там,
   * где показывать действительно нечего: первый заход и смена фильтров.
   */
  const load = (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    listKnowledge({
      search: search || undefined,
      category: category || undefined,
      drafts: includeDrafts,
    })
      .then(setItems)
      // Фоновое обновление не стираем: на экране лежит выборка по тем же
      // фильтрам, просто чуть более старая. Регламент, который человек сейчас
      // читает, не должен исчезать из-за сетевой заминки.
      .catch(() => {
        if (!silent) setItems([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, showDrafts, canEdit]);

  useEffect(() => {
    listKnowledgeCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  /**
   * Фоновая сверка с сервером — после собственного действия и по realtime.
   *
   * Задержка склеивает эхо своего действия с собственным вызовом в один поход
   * за списком и не даёт перезагрузке лечь между локальным изменением и
   * ответом сервера. Задвоить строки она не может: load ЗАМЕНЯЕТ список
   * целиком, а не дописывает в него пришедшую статью.
   */
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load({ silent: true });
    }, 500);
  };
  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  // Регламент правит руководство, а читают его менеджеры — и до сих пор
  // видели прежний текст, пока не перезагрузят страницу. Для инструкции,
  // по которой человек прямо сейчас действует, это хуже, чем для списка.
  useRealtime({
    'knowledge:updated': () => scheduleReload(),
  });

  const categoryLabel = (value: string) => categories.find((c) => c.value === value)?.label ?? value;

  /**
   * Выборку и порядок задаёт сервер (knowledge.service.findAll): черновики
   * только при drafts=true, раздел — точное совпадение, поиск — «содержит» по
   * заголовку ИЛИ тексту без учёта регистра, сортировка sortOrder → createdAt
   * по возрастанию. Повторяем это локально, чтобы сохранённая статья вставала
   * ровно туда, где её покажет сервер, и не мелькала в списке, из которого она
   * выпадает: снятый с публикации черновик при выключенном «показывать
   * черновики» должен исчезнуть сразу, а не через полсекунды.
   */
  const matchesFilters = (a: KnowledgeArticle) =>
    (includeDrafts || a.published) &&
    (!category || a.category === category) &&
    (!search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.body.toLowerCase().includes(search.toLowerCase()));

  /**
   * Поставить сохранённую статью на её место в списке. Сначала убираем прежнюю
   * версию — так один и тот же id не может оказаться в списке дважды, чем бы ни
   * было сохранение: правкой существующей статьи или созданием новой.
   */
  const applySaved = (list: KnowledgeArticle[], a: KnowledgeArticle) => {
    const rest = removeById(list, a.id);
    if (!matchesFilters(a)) return rest;
    const at = rest.findIndex(
      (x) => x.sortOrder > a.sortOrder || (x.sortOrder === a.sortOrder && x.createdAt > a.createdAt),
    );
    return at < 0 ? [...rest, a] : [...rest.slice(0, at), a, ...rest.slice(at)];
  };

  const onDelete = async (a: KnowledgeArticle) => {
    const ok = await confirm({
      title: 'Удалить статью',
      message: `«${a.title}» перестанет отображаться в базе знаний и исчезнет из контекста AI-помощника. Данные останутся в системе.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    // Статья исчезает сразу. При отказе сервера она возвращается на место и,
    // если была раскрыта, снова раскрывается: экран обязан вернуться ровно в то
    // состояние, из которого человек нажал «Удалить».
    const wasOpen = openId === a.id;
    if (wasOpen) setOpenId(null);
    const res = await runOptimistic<KnowledgeArticle[], unknown>({
      current: items,
      optimistic: (prev) => removeById(prev, a.id),
      commit: setItems,
      request: () => deleteKnowledgeArticle(a.id),
      onError: (msg) => {
        if (wasOpen) setOpenId(a.id);
        toast(msg, 'error');
      },
    });
    if (res !== null) {
      toast('Статья удалена', 'success');
      scheduleReload();
    }
  };

  return (
    <div>
      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="card-header">
          <h2 className="card-title">База знаний</h2>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditor('new')}>
              <Icon name="add" size={16} />
              Новая статья
            </button>
          )}
        </div>

        <div className="card-body">
          <div className="kb-hint">
            <Icon name="smart_toy" size={18} />
            <div>
              AI-помощник отвечает сотрудникам <strong>только по опубликованным статьям этого раздела</strong>.
              Чем точнее регламент здесь — тем точнее ответы бота.
            </div>
          </div>

          <div className="filters">
            <input
              placeholder="Поиск по заголовку и тексту..."
              value={search}
              onChange={(e) => setFilters({ search: e.target.value })}
            />
            <select value={category} onChange={(e) => setFilters({ category: e.target.value })}>
              <option value="">Все разделы</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {canEdit && (
              <label className="filter-check" title="Черновики не видны сотрудникам и не попадают в ответы AI-помощника">
                <input
                  type="checkbox"
                  checked={showDrafts}
                  onChange={(e) => setFilters({ drafts: e.target.checked ? '1' : '' })}
                />
                Показывать черновики
              </label>
            )}
          </div>

          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Загрузка...
              </motion.div>
            ) : items.length === 0 ? (
              <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="empty-icon"><Icon name="menu_book" size={48} /></div>
                {search || category ? 'По этому запросу статей нет' : 'В базе знаний пока нет статей'}
              </motion.div>
            ) : (
              <motion.div key="list" className="kb-list" variants={staggerContainer} initial="hidden" animate="show">
                {items.map((a) => {
                  const open = openId === a.id;
                  return (
                    <motion.div key={a.id} className={`kb-item${open ? ' open' : ''}`} variants={fadeUp}>
                      <button className="kb-item-head" onClick={() => setOpenId(open ? null : a.id)}>
                        <Icon name={open ? 'expand_less' : 'expand_more'} size={20} />
                        <div className="kb-item-title">
                          {a.title}
                          {!a.published && (
                            <span className="badge badge-warning" style={{ marginLeft: 8 }}>Черновик</span>
                          )}
                        </div>
                        <span className="badge badge-info">{categoryLabel(a.category)}</span>
                      </button>

                      {open && (
                        <div className="kb-item-body">
                          <div className="kb-article-text">{a.body}</div>
                          {a.tags.length > 0 && (
                            <div className="kb-tags">
                              {a.tags.map((t) => (
                                <span key={t} className="kb-tag">#{t}</span>
                              ))}
                            </div>
                          )}
                          <div className="kb-item-meta">
                            Обновлено {new Date(a.updatedAt).toLocaleDateString('ru-RU')}
                            {a.updatedBy ? ` · ${a.updatedBy.fullName}` : a.createdBy ? ` · ${a.createdBy.fullName}` : ''}
                          </div>
                          {canEdit && (
                            <div className="row-actions">
                              <button className="btn btn-sm btn-secondary" onClick={() => setEditor(a)}>
                                <Icon name="edit" size={16} />
                                Редактировать
                              </button>
                              <button className="btn btn-sm btn-danger" onClick={() => onDelete(a)}>
                                <Icon name="delete" size={16} />
                                Удалить
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence>
        {editor && (
          <ArticleEditor
            article={editor === 'new' ? null : editor}
            categories={categories}
            onClose={() => setEditor(null)}
            /*
              Редактор отдаёт СОХРАНЁННУЮ статью, и список правится ею на месте —
              вместо второго похода за всем разделом. Оптимистично, до ответа
              сервера, тут показывать нечего: редактор — модалка поверх списка,
              изменений под ней всё равно не видно, а закрывать форму заранее
              значило бы при отказе возвращать её с уже набранным текстом статьи.
              Текст регламента пишут долго — потерять его дороже, чем выиграть
              двести миллисекунд.
            */
            onSaved={(saved) => {
              setEditor(null);
              setItems((prev) => applySaved(prev, saved));
              scheduleReload();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ArticleEditor({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: KnowledgeArticle | null;
  categories: KnowledgeCategory[];
  onClose: () => void;
  /** Отдаёт статью, которую вернул сервер: по ней родитель правит список без перезагрузки. */
  onSaved: (saved: KnowledgeArticle) => void;
}) {
  const { toast } = useUI();
  const [title, setTitle] = useState(article?.title ?? '');
  const [category, setCategory] = useState(article?.category ?? 'GENERAL');
  const [body, setBody] = useState(article?.body ?? '');
  const [tags, setTags] = useState((article?.tags ?? []).join(', '));
  const [published, setPublished] = useState(article?.published ?? true);
  const [sortOrder, setSortOrder] = useState(String(article?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    const payload = {
      title: title.trim(),
      category,
      body: body.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
      published,
      sortOrder: parseInt(sortOrder, 10) || 0,
    };
    try {
      // Отдаём наверх то, что реально сохранено: сервер тримит текст, подставляет
      // updatedAt и автора правки — предсказать эти поля клиент не может.
      const saved = article
        ? await updateKnowledgeArticle(article.id, payload)
        : await createKnowledgeArticle(payload);
      toast(article ? 'Статья обновлена' : 'Статья добавлена', 'success');
      onSaved(saved);
    } catch (err: any) {
      // Форма остаётся открытой со всем набранным — причина отказа над полями.
      setError(err?.response?.data?.message?.toString() || 'Не удалось сохранить статью');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 760, textAlign: 'left' }}
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.2 }}
      >
        <div className="dialog-title" style={{ textAlign: 'left' }}>
          {article ? 'Редактировать статью' : 'Новая статья'}
        </div>

        <form onSubmit={onSubmit}>
          {error && <div className="error-banner">{error}</div>}

          <div className="form-group">
            <label>Заголовок *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Как принять оплату наличными"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Раздел</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>
                Порядок{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>
                  — меньше = выше в списке
                </span>
              </label>
              <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Текст статьи *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              placeholder={
                'Пишите так, как объясняли бы новому сотруднику: по шагам, с конкретными кнопками и сроками.\n' +
                'Этот текст дословно уходит в контекст AI-помощника — что здесь написано, то бот и ответит.'
              }
            />
          </div>

          <div className="form-group">
            <label>
              Теги{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>
                — через запятую, помогают поиску
              </span>
            </label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="оплата, чек, касса" />
          </div>

          <label className="filter-check" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Опубликовать
          </label>
          {!published && (
            <div className="receipt-dropzone-hint">
              Черновик не виден сотрудникам и <strong>не попадает в ответы AI-помощника</strong>.
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
