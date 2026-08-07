import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createComment, deleteComment, listComments, updateComment, type Comment } from '../api/comments';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { formatDateTimeRu } from '../utils/datetime';
import Icon from '../Icon';
import { isTempId, removeById, replaceById, runOptimistic, tempId } from '../utils/optimistic';

type Props =
  | { studentId: string; applicationId?: never; canAdd: boolean }
  | { applicationId: string; studentId?: never; canAdd: boolean };

const PAGE_SIZE = 50;

/**
 * ТЗ 6.3 — лента текстовых комментариев (кто, когда, что написал). Отдельная
 * от Student.comment/Application.comment сущность: то поле — одна строка без
 * автора и времени («Комментарий из анкеты»), эта лента — история.
 *
 * Доступ на ЧТЕНИЕ уже гарантирован тем, что родительская страница (карточка
 * студента/заявки) вообще открылась — GET /students/:id и GET /comments
 * используют одну и ту же проверку (canAccessStudentRecord). А вот кнопка
 * добавления должна быть СКРЫТА (не disabled), если canAdd=false — тот же
 * принцип, что у остальных форм редактирования в карточке.
 */
export default function CommentsFeed({ studentId, applicationId, canAdd }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  /**
   * Актуальная лента для оптимистичных обновлений: `items` из замыкания
   * обработчика успевает устареть, пока человек отвечает на вопрос «удалить?»
   * или пока по сокету приезжает чужой комментарий. Откатываться надо к тому,
   * что было на экране в момент запроса, а не в момент отрисовки кнопки.
   */
  const itemsRef = useRef<Comment[]>(items);
  itemsRef.current = items;

  /**
   * Ключ строки для React.
   *
   * Отправленный комментарий сначала живёт с временным id, а после ответа
   * сервера получает настоящий. Если ключом сделать сам id, AnimatePresence
   * увидит «одна запись ушла, другая пришла» и на время exit-анимации покажет
   * ДВЕ одинаковые реплики подряд. Поэтому выданный ключ закрепляем за записью
   * до конца жизни компонента — в том числе после перезагрузки ленты, где та
   * же запись приедет уже с настоящим id.
   */
  const rowKeys = useRef(new Map<string, string>());
  const rowKey = (id: string) => rowKeys.current.get(id) || id;

  /**
   * `silent` — обновление без «Загрузка...» и без обнуления ленты при сбое.
   *
   * Так перезагружаемся по событиям сокета: своё же изменение уже показано
   * оптимистично, и подменять на полсекунды всю ленту заглушкой ради сверки
   * незачем. А если фоновый запрос не удался, старые комментарии должны
   * остаться на экране: пустая лента вместо них выглядит как «всё удалилось».
   */
  const load = (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    listComments({ studentId, applicationId, page: 1, pageSize: PAGE_SIZE })
      .then((res) => setItems(res.items))
      .catch(() => { if (!opts.silent) setItems([]); })
      .finally(() => { if (!opts.silent) setLoading(false); });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, applicationId]);

  const matchesScope = (d: any) =>
    (studentId && d?.studentId === studentId) || (applicationId && d?.applicationId === applicationId);

  useRealtime({
    // Ответ сервера на наш запрос и событие о нём — две разные новости об одном
    // и том же. Задвоить строку они не могут: load() заменяет массив целиком,
    // а reconcile ниже собирает список из снимка ДО добавления.
    'comment:new': (d: any) => { if (matchesScope(d)) load({ silent: true }); },
    'comment:updated': (d: any) => { if (matchesScope(d)) load({ silent: true }); },
    'comment:deleted': (d: any) => { if (matchesScope(d)) load({ silent: true }); },
  });

  const onAdd = async () => {
    const body = text.trim();
    if (!body) return;

    const now = new Date().toISOString();
    // Автор, текст и время известны клиенту целиком — реплика встаёт в ленту
    // такой же, какой придёт с сервера. Настоящий id подставит reconcile.
    const pending: Comment = {
      id: tempId(),
      body,
      studentId: studentId ?? null,
      applicationId: applicationId ?? null,
      authorId: me?.id ?? null,
      author: me ? { id: me.id, fullName: me.fullName } : null,
      editedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Поле освобождаем сразу — писать следующий комментарий можно, не дожидаясь
    // ответа.
    setText('');

    await runOptimistic({
      current: itemsRef.current,
      // Лента приходит с сервера отсортированной по createdAt убыванию, поэтому
      // новое — наверх.
      optimistic: (prev) => [pending, ...prev],
      commit: setItems,
      request: () => createComment({ studentId, applicationId, body }),
      // Подменяем ВРЕМЕННУЮ строку на настоящую в ТЕКУЩЕМ состоянии, а не
      // пересобираем список из снимка «до».
      //
      // Снимок «до» здесь неверен: поле ввода намеренно освобождается сразу, и
      // человек отправляет вторую реплику, не дожидаясь первой. Пока летел
      // первый запрос, в состоянии появилась вторая строка — а `[created,
      // ...prev]` вернуло бы список без неё, и вторая реплика исчезла бы с
      // экрана (на сервере при этом сохранившись).
      //
      // Замена по временному id безопасна и от задвоения: настоящая запись
      // встаёт ровно на место предсказанной, а не добавляется рядом.
      reconcile: (_prev, created) => {
        rowKeys.current.set(created.id, pending.id);
        return itemsRef.current.map((it) => (it.id === pending.id ? created : it));
      },
      onError: (msg) => {
        // Возвращаем текст, чтобы не набирать заново — но только если поле
        // пустое: пока запрос шёл, человек мог начать писать следующую реплику,
        // и затирать её своим откатом мы не вправе.
        setText((cur) => (cur.trim() ? cur : body));
        toast(msg, 'error');
      },
    });
  };

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditText(c.body);
  };

  const onSaveEdit = async (id: string) => {
    const body = editText.trim();
    if (!body) return;
    // Запись ещё не подтверждена сервером — PATCH ушёл бы по временному id.
    if (isTempId(id)) return;

    // Редактор закрываем сразу, но черновик держим: при отказе сервера он
    // откроется снова с этим же текстом.
    setEditingId(null);

    await runOptimistic({
      current: itemsRef.current,
      // editedAt проставляем сами, иначе пометка «изменено» появилась бы позже
      // самого изменения. Точное время придёт с сервером в reconcile.
      optimistic: (prev) => replaceById(prev, id, { body, editedAt: new Date().toISOString() }),
      commit: setItems,
      request: () => updateComment(id, body),
      reconcile: (prev, updated) => replaceById(prev, id, updated),
      onError: (msg) => {
        setEditingId(id);
        setEditText(body);
        toast(msg, 'error');
      },
    });
  };

  const onDelete = async (c: Comment) => {
    if (isTempId(c.id)) return;
    const ok = await confirm({
      title: 'Удалить комментарий',
      message: 'Запись будет удалена из ленты. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    const res = await runOptimistic({
      current: itemsRef.current,
      optimistic: (prev) => removeById(prev, c.id),
      commit: setItems,
      request: () => deleteComment(c.id),
      onError: (msg) => toast(msg, 'error'),
    });
    // runOptimistic возвращает null только при ошибке — тело ответа не важно.
    if (res !== null) toast('Комментарий удалён', 'success');
  };

  return (
    <div className="comments-feed">
      <div className="comments-feed-title">
        <Icon name="forum" size={18} style={{ marginRight: 6 }} />
        Комментарии
      </div>

      {canAdd && (
        <div className="comments-feed-add">
          {/* Поле не блокируется на время запроса: реплика уходит в ленту
              мгновенно, и следующую можно набирать сразу. */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={2}
            placeholder="Добавить комментарий..."
          />
          <button className="btn btn-sm btn-primary" onClick={onAdd} disabled={!text.trim()}>
            <Icon name="send" size={15} style={{ marginRight: 4 }} />
            Добавить
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="empty" style={{ padding: 16 }}>Комментариев пока нет</div>
      ) : (
        <div className="comments-feed-list">
          <AnimatePresence initial={false}>
            {items.map((c) => {
              // Строки ещё нет на сервере: править и удалять нечего — настоящего
              // id у неё нет, запрос ушёл бы в никуда.
              const isPending = isTempId(c.id);
              const canManage = !isPending && !!me && (c.authorId === me.id || isPrivileged(me.role));
              const isEditing = editingId === c.id;
              return (
                <motion.div
                  key={rowKey(c.id)}
                  className="comment-item"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: isPending ? 0.6 : 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="comment-item-head">
                    <span className="comment-item-author">
                      <Icon name="person" size={13} /> {c.author?.fullName || 'Неизвестный'}
                    </span>
                    <span className="comment-item-time">
                      {isPending ? 'отправляется...' : formatDateTimeRu(c.createdAt)}
                      {!isPending && c.editedAt && ' · изменено'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="comments-feed-add">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        maxLength={4000}
                        rows={2}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>
                          Отмена
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => onSaveEdit(c.id)}
                          disabled={!editText.trim()}
                        >
                          Сохранить
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="comment-item-body">{c.body}</div>
                      {canManage && (
                        <div className="comment-item-actions">
                          <button type="button" className="comment-icon-btn" title="Изменить" onClick={() => startEdit(c)}>
                            <Icon name="edit" size={14} />
                          </button>
                          <button type="button" className="comment-icon-btn" title="Удалить" onClick={() => onDelete(c)}>
                            <Icon name="delete" size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
