import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createComment, deleteComment, listComments, updateComment, type Comment } from '../api/comments';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { formatDateTimeRu } from '../utils/datetime';
import Icon from '../Icon';

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
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = () => {
    setLoading(true);
    listComments({ studentId, applicationId, page: 1, pageSize: PAGE_SIZE })
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, applicationId]);

  const matchesScope = (d: any) =>
    (studentId && d?.studentId === studentId) || (applicationId && d?.applicationId === applicationId);

  useRealtime({
    'comment:new': (d: any) => { if (matchesScope(d)) load(); },
    'comment:updated': (d: any) => { if (matchesScope(d)) load(); },
    'comment:deleted': (d: any) => { if (matchesScope(d)) load(); },
  });

  const onAdd = async () => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      await createComment({ studentId, applicationId, body });
      setText('');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка добавления комментария', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditText(c.body);
  };

  const onSaveEdit = async (id: string) => {
    const body = editText.trim();
    if (!body) return;
    setSaving(true);
    try {
      await updateComment(id, body);
      setEditingId(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (c: Comment) => {
    const ok = await confirm({
      title: 'Удалить комментарий',
      message: 'Запись будет удалена из ленты. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteComment(c.id);
      toast('Комментарий удалён', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  return (
    <div className="comments-feed">
      <div className="comments-feed-title">
        <Icon name="forum" size={18} style={{ marginRight: 6 }} />
        Комментарии
      </div>

      {canAdd && (
        <div className="comments-feed-add">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={2}
            placeholder="Добавить комментарий..."
            disabled={saving}
          />
          <button className="btn btn-sm btn-primary" onClick={onAdd} disabled={saving || !text.trim()}>
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
              const canManage = !!me && (c.authorId === me.id || isPrivileged(me.role));
              const isEditing = editingId === c.id;
              return (
                <motion.div
                  key={c.id}
                  className="comment-item"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="comment-item-head">
                    <span className="comment-item-author">
                      <Icon name="person" size={13} /> {c.author?.fullName || 'Неизвестный'}
                    </span>
                    <span className="comment-item-time">
                      {formatDateTimeRu(c.createdAt)}
                      {c.editedAt && ' · изменено'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="comments-feed-add">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        maxLength={4000}
                        rows={2}
                        disabled={saving}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)} disabled={saving}>
                          Отмена
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => onSaveEdit(c.id)}
                          disabled={saving || !editText.trim()}
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
