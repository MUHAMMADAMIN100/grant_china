import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { listChinaTransferCandidates } from '../api/students';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

// Ровно то, что отдаёт узкий эндпоинт: имя и идентификатор. Ни роли, ни
// региона окну выбора не нужно — сервер уже отфильтровал тех, кого примет.
type Candidate = { id: string; fullName: string };

type Props = {
  studentId: string;
  studentName: string;
  onClose: () => void;
  /** Передача — оптимистичное действие, владеет им StudentDetail (см. onTransferToChina). */
  onConfirm: (chinaManagerId: string) => Promise<void>;
};

/**
 * ТЗ «Разделение воронок» — выбор получателя при передаче студента в
 * китайский офис.
 *
 * Список зеркалит условие ОТКАЗА сервера, а не выдумывает своё:
 * students.service.ts transferToChina() отклоняет получателя единственным
 * условием — `role === EMPLOYEE && region === 'TJ'`. От противного, годятся
 * EMPLOYEE с region CN/BOTH (регион не пришедший из старого бэкенда читаем
 * как BOTH — тот же принцип, что у User.region в api/types.ts). FOUNDER и
 * ADMIN сервер как получателя формально пропустил бы, но подборка тут —
 * именно КИТАЙСКИЙ МЕНЕДЖЕР, а не «кто угодно, кого сервер не завернёт»,
 * поэтому руководство в список не подмешиваем.
 *
 * ВАЖНО: GET /users отдаёт список ТОЛЬКО FOUNDER и ADMIN (users.controller.ts
 * @Roles) — назначенный таджикский менеджер (обычный EMPLOYEE), которому эта
 * кнопка тоже положена по ТЗ, получит на этот запрос 403. Самому действию
 * передачи это не мешает (сервер его разрешает), поэтому кнопку открытия
 * модалки мы не прячем — но список получателей показать ему нечем. Ошибку не
 * глотаем молча: как PaymentsSection на 404 чужого студента, показываем
 * понятный текст вместо пустого/сломанного селекта.
 */
export default function ChinaTransferModal({ studentId, studentName, onClose, onConfirm }: Props) {
  const { toast } = useUI();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Фильтровать на клиенте больше нечего: сервер отдаёт уже готовый список
    // тех, кого он же и примет. Клиентский фильтр по региону был вторым
    // источником истины и разошёлся бы с серверным при первой же правке.
    listChinaTransferCandidates(studentId)
      .then(setCandidates)
      .catch((e: any) => setForbidden(e?.response?.status === 403 || e?.response?.status === 404))
      .finally(() => setLoading(false));
  }, [studentId]);

  const onSubmit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onConfirm(selected);
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка передачи студента', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="dialog-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-icon">
          <Icon name="flight_takeoff" size={28} />
        </div>
        <div className="dialog-title">Передать в Китай</div>
        <div className="dialog-message">
          {studentName} перейдёт в работу китайского офиса: откроются этапы 1.1, 3 и расходы на
          месте, выбранный менеджер получит уведомление.
        </div>

        {loading ? (
          <div className="empty" style={{ padding: 12 }}>Загрузка списка менеджеров…</div>
        ) : forbidden ? (
          <div className="receipt-dropzone-hint">
            Список менеджеров по Китаю виден только Основателю и Администратору. Попросите
            кого-то из них выбрать получателя — самостоятельно назначить его отсюда нельзя.
          </div>
        ) : candidates.length === 0 ? (
          <div className="receipt-dropzone-hint">
            Нет ни одного сотрудника с доступом к китайскому офису. Назначьте региону «Китай» или
            «Оба региона» на странице «Сотрудники» — тогда он появится здесь.
          </div>
        ) : (
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label>Менеджер (Китай)</label>
            <select
              autoFocus
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={saving}
            >
              <option value="">Выберите получателя</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          {!forbidden && candidates.length > 0 && (
            <button className="btn btn-primary" onClick={onSubmit} disabled={saving || !selected}>
              {saving ? 'Передача…' : 'Передать'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
