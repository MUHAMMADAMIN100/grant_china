import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Payment, PaymentStage, PaymentStageSummary, PaymentSummary } from '../api/types';
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_PURPOSE_LABEL,
  canManageFinance,
  canWriteFinance,
  isFounder,
} from '../api/types';
import {
  approvePayment,
  deletePayment,
  getPaymentsSummary,
  recallPayment,
  rejectPayment,
  submitPayment,
  voidPayment,
} from '../api/payments';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { buildFileUrl } from '../utils/fileUrl';
import { formatMoney } from '../utils/money';
import PaymentStatusBadge from './PaymentStatusBadge';
import PaymentFormModal from './PaymentFormModal';
import ScheduleEditModal from './ScheduleEditModal';
import PaymentReasonPrompt from './PaymentReasonPrompt';
import Icon from '../Icon';

type ModalState =
  | { kind: 'create'; stage: PaymentStage }
  | { kind: 'edit'; payment: Payment }
  | { kind: 'schedule'; stage: PaymentStage; current: PaymentStageSummary }
  | { kind: 'reject'; payment: Payment }
  | { kind: 'void'; payment: Payment }
  | null;

const ON_SITE_PAGE_SIZE = 6;

type Props = {
  studentId: string;
  /**
   * Ведёт ли текущий пользователь этого студента (привилегия роли || свой менеджер).
   * Это ответ только на вопрос «чей студент», а НЕ на вопрос «можно ли писать в
   * финансы»: у Администратора canEdit истинно (он видит всех студентов), но
   * финансы для него read-only — см. canWrite ниже.
   */
  canEdit: boolean;
};

export default function PaymentsSection({ studentId, canEdit }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // HTTP-код неудачной загрузки (null — сети/ответа не было). Нужен именно
  // код: 404 здесь штатный ответ сотруднику по студенту без назначенного
  // менеджера (чужой ресурс = 404), и объяснять его надо иначе, чем сбой.
  const [loadError, setLoadError] = useState<{ status: number | null } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [onSiteExpanded, setOnSiteExpanded] = useState(false);

  const isFdr = isFounder(me?.role);
  /**
   * ТЗ v3 раздел 4, критерий приёмки №4: «Администратор имеет доступ к финансам
   * СТРОГО в режиме Read-Only». Все методы записи по платежам на бэкенде теперь
   * помечены @Roles(FOUNDER, EMPLOYEE) — Администратор получает на них 403.
   * Поэтому кнопки этих действий ему не показываем вовсе: disabled-кнопка без
   * объяснения читается как поломка интерфейса (правило проекта).
   */
  const canWrite = canWriteFinance(me?.role);
  /**
   * График платежей (PUT /payments/schedule) сузился до @Roles(FOUNDER):
   * плановая сумма и срок этапа — предмет договора со студентом, менять их
   * может только Основатель. Раньше карандаш правки видел и Администратор.
   */
  const canManageSchedule = canManageFinance(me?.role);
  /**
   * Внести платёж можно, только если верно и «студент мой», и «роль пишет в
   * финансы». Разделение важно именно для Администратора: canEdit у него
   * истинно по всем студентам, а права записи нет.
   */
  const canAddPayment = canEdit && canWrite;

  const load = () => {
    getPaymentsSummary(studentId)
      .then((s) => { setSummary(s); setLoadError(null); })
      .catch((e: any) => { setLoadError({ status: e?.response?.status ?? null }); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Тонкие realtime-события (только id) — при любом изменении просто
  // перезапрашиваем сводку целиком, суммы должен считать только сервер.
  const reloadIfMine = (d: any) => { if (!d || d.studentId === studentId) load(); };
  useRealtime({
    'payment:created': reloadIfMine,
    'payment:updated': reloadIfMine,
    'payment:submitted': reloadIfMine,
    'payment:recalled': reloadIfMine,
    'payment:approved': reloadIfMine,
    'payment:rejected': reloadIfMine,
    'payment:voided': reloadIfMine,
    'payment:deleted': reloadIfMine,
    'payment:receipt-added': reloadIfMine,
    'payment:receipt-removed': reloadIfMine,
    'payment:schedule-updated': reloadIfMine,
    // Этап 2.1 разблокируется после перевода заявки в «Зачислен» — без
    // подписки на это событие карточка платежей осталась бы заблокированной
    // до ручного обновления страницы.
    'application:updated': (d: any) => {
      const sid = d?.studentId ?? d?.application?.studentId;
      if (sid === undefined || sid === studentId) load();
    },
  });

  const handleSubmitPayment = async (p: Payment) => {
    if (p.receipts.length === 0) {
      toast('Прикрепите чек перед отправкой на одобрение', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Отправить на одобрение',
      message: `Платёж на ${formatMoney(p.amount)} будет отправлен Основателю на проверку. До его решения данные нельзя редактировать (можно только отозвать).`,
      confirmText: 'Отправить',
    });
    if (!ok) return;
    try {
      await submitPayment(p.id);
      toast('Платёж отправлен на одобрение Основателю', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка отправки платежа', 'error');
    }
  };

  const handleRecall = async (p: Payment) => {
    const ok = await confirm({
      title: 'Отозвать платёж',
      message: 'Платёж вернётся в черновик — вы сможете отредактировать данные и отправить заново.',
      confirmText: 'Отозвать',
    });
    if (!ok) return;
    try {
      await recallPayment(p.id);
      toast('Платёж отозван', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка отзыва платежа', 'error');
    }
  };

  const handleDelete = async (p: Payment) => {
    const ok = await confirm({
      title: 'Удалить платёж',
      message: 'Черновик/отклонённый платёж будет удалён безвозвратно.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePayment(p.id);
      toast('Платёж удалён', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления платежа', 'error');
    }
  };

  const handleApprove = async (p: Payment) => {
    const ok = await confirm({
      title: 'Одобрить платёж',
      message: `Подтвердите фактическое поступление ${formatMoney(p.amount)}. После одобрения платёж будет считаться проведённым и его нельзя будет изменить.`,
      confirmText: 'Одобрить',
    });
    if (!ok) return;
    try {
      await approvePayment(p.id, p.updatedAt);
      toast('Платёж одобрен', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка одобрения платежа', 'error');
    }
  };

  const onConfirmReject = async (reason: string) => {
    if (modal?.kind !== 'reject') return;
    try {
      await rejectPayment(modal.payment.id, reason);
      toast('Платёж отклонён', 'success');
      setModal(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка отклонения платежа', 'error');
    }
  };

  const onConfirmVoid = async (reason: string) => {
    if (modal?.kind !== 'void') return;
    try {
      await voidPayment(modal.payment.id, reason);
      toast('Платёж аннулирован', 'success');
      setModal(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка аннулирования платежа', 'error');
    }
  };

  if (loading && !summary) {
    return (
      <div className="payments-section">
        <div className="payments-section-title">Финансы</div>
        <div className="empty" style={{ padding: 24 }}>Загрузка финансов…</div>
      </div>
    );
  }
  // Молчаливый return null читался пользователем как «у студента нет
  // финансов»: блок исчезал целиком, без заголовка и без причины.
  if (!summary) {
    const forbidden = loadError?.status === 404;
    return (
      <div className="payments-section">
        <div className="payments-section-title">Финансы</div>
        <div className="empty" style={{ padding: 24 }}>
          {forbidden ? 'Финансы этого студента доступны администратору' : 'Не удалось загрузить финансы'}
          {!forbidden && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => { setLoading(true); load(); }}>
                Повторить
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const renderPaymentRow = (p: Payment) => {
    // Право «править чужой платёж» раньше давала isPrivileged (FOUNDER+ADMIN).
    // Теперь оно только у Основателя: Администратор в финансах read-only, а
    // Сотрудник ведёт лишь свои записи — ровно так же рассуждает payments.service.
    const canMutate = canWrite && (isFdr || p.createdById === me?.id);
    const canRecall = canWrite && (isFdr || p.submittedById === me?.id);
    // Double Check (ТЗ 1.1): бэкенд блокирует одобрение, если пользователь
    // причастен к платежу — как автор ИЛИ как подавший. Оба условия должны
    // быть отражены здесь, иначе кнопка активна, а клик возвращает 409.
    const submittedByMe = !!p.submittedById && p.submittedById === me?.id;
    const createdByMe = !!p.createdById && p.createdById === me?.id;
    const cannotApprove = submittedByMe || createdByMe;
    const cannotApproveReason = createdByMe
      ? 'Вы внесли этот платёж — одобрить должен другой пользователь'
      : 'Вы подали этот платёж — одобрить должен другой пользователь';

    const showDraftActions = (p.status === 'DRAFT' || p.status === 'REJECTED') && canMutate;
    const showRecall = p.status === 'PENDING_APPROVAL' && canRecall;
    const showApproval = p.status === 'PENDING_APPROVAL' && isFdr;
    const showVoid = p.status === 'APPROVED' && isFdr;
    // .payment-row — это flex-колонка с gap: 6px, поэтому пустой контейнер
    // действий оставляет висящий отступ под каждой строкой. У Администратора
    // такая пустая полоса теперь была бы во ВСЕХ строках — не рендерим её.
    const hasActions = showDraftActions || showRecall || showApproval || showVoid;

    return (
      <div key={p.id} className="payment-row">
        <div className="payment-row-main">
          <PaymentStatusBadge status={p.status} />
          <span className="payment-row-amount">{formatMoney(p.amount)}</span>
          <span className="payment-row-purpose">{PAYMENT_PURPOSE_LABEL[p.purpose]}</span>
          <span className="payment-row-method">{PAYMENT_METHOD_LABEL[p.method]}</span>
          <span className="payment-row-date">{new Date(p.paidAt).toLocaleDateString('ru-RU')}</span>
        </div>
        <div className="payment-row-meta">
          {p.createdBy && (
            <span><Icon name="person" size={13} /> {p.createdBy.fullName}</span>
          )}
          {p.reference && (
            <span><Icon name="tag" size={13} /> {p.reference}</span>
          )}
          {p.receipts.length > 0 && (
            <span className="payment-row-receipts">
              <Icon name="attach_file" size={13} />
              {p.receipts.map((r, i) => (
                <a key={r.id} href={buildFileUrl(r.url)} target="_blank" rel="noreferrer">
                  {i > 0 ? ', ' : ''}чек{p.receipts.length > 1 ? ` №${i + 1}` : ''}
                </a>
              ))}
            </span>
          )}
        </div>
        {p.status === 'REJECTED' && p.rejectionReason && (
          <div className="payment-row-reason danger">
            <Icon name="report" size={14} /> Отклонён: {p.rejectionReason}
          </div>
        )}
        {p.status === 'VOID' && p.voidReason && (
          <div className="payment-row-reason">
            <Icon name="block" size={14} /> Аннулирован: {p.voidReason}
          </div>
        )}
        {hasActions && (
          <div className="payment-row-actions">
            {showDraftActions && (
              <>
                <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'edit', payment: p })}>
                  Редактировать
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => handleSubmitPayment(p)}>
                  Подать
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>
                  Удалить
                </button>
              </>
            )}
            {showRecall && (
              <button className="btn btn-sm btn-secondary" onClick={() => handleRecall(p)}>Отозвать</button>
            )}
            {showApproval && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleApprove(p)}
                  disabled={cannotApprove}
                  title={cannotApprove ? cannotApproveReason : undefined}
                >
                  Одобрить
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setModal({ kind: 'reject', payment: p })}>
                  Отклонить
                </button>
              </>
            )}
            {showVoid && (
              <button className="btn btn-sm btn-danger" onClick={() => setModal({ kind: 'void', payment: p })}>
                Аннулировать
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderStageCard = (s: PaymentStageSummary) => {
    const planned = parseFloat(s.plannedAmount);
    const paid = parseFloat(s.paidAmount);
    const pending = parseFloat(s.pendingAmount);
    const percent = planned > 0 ? Math.min(100, Math.round((paid / planned) * 100)) : paid > 0 ? 100 : 0;

    let statusLabel = 'Не оплачено';
    let statusCls = 'badge-gray';
    if (s.locked) { statusLabel = 'Заблокировано'; statusCls = 'badge-gray'; }
    else if (planned > 0 && paid >= planned) { statusLabel = 'Оплачено'; statusCls = 'badge-success'; }
    else if (pending > 0) { statusLabel = 'На одобрении'; statusCls = 'badge-warning'; }
    else if (paid > 0) { statusLabel = 'Частично оплачено'; statusCls = 'badge-info'; }

    return (
      <motion.div
        key={s.stage}
        layout
        className={`payment-stage-card${s.locked ? ' locked' : ''}`}
      >
        <div className="payment-stage-card-head">
          <div className="payment-stage-card-title">
            {s.locked && <Icon name="lock" size={16} style={{ marginRight: 4, color: 'var(--text-light)' }} />}
            {s.label}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {s.overdue && <span className="badge badge-danger">Просрочено</span>}
            <span className={`badge ${statusCls}`}>{statusLabel}</span>
          </div>
        </div>

        {s.locked ? (
          <div className="payment-stage-locked-note">
            Активируется после успешного зачисления в университет (официальное письмо/приказ о зачислении). Переведите статус заявки выше на «Зачислен».
          </div>
        ) : null}

        <div className="payment-stage-figures">
          <div>
            <span>План</span>
            <strong>
              {formatMoney(s.plannedAmount)}
              {canManageSchedule && (
                <button
                  type="button"
                  className="payment-stage-plan-edit"
                  title="Изменить плановую сумму/срок"
                  onClick={() => setModal({ kind: 'schedule', stage: s.stage, current: s })}
                >
                  <Icon name="edit" size={13} />
                </button>
              )}
            </strong>
          </div>
          <div><span>Оплачено</span><strong className="text-success">{formatMoney(s.paidAmount)}</strong></div>
          {pending > 0 && <div><span>На одобрении</span><strong className="text-warning">{formatMoney(s.pendingAmount)}</strong></div>}
          <div><span>Остаток</span><strong>{formatMoney(s.remainingAmount)}</strong></div>
          <div>
            <span>Срок</span>
            <strong>{s.dueDate ? new Date(s.dueDate).toLocaleDateString('ru-RU') : '—'}</strong>
          </div>
        </div>

        {planned > 0 && (
          <div className="payment-stage-progress">
            <div className="payment-stage-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        )}

        {s.payments.length > 0 && (
          <div className="payment-rows">
            {s.payments.map(renderPaymentRow)}
          </div>
        )}

        {canAddPayment && !s.locked && (
          <button
            type="button"
            className="btn btn-sm btn-secondary payment-stage-add-btn"
            onClick={() => setModal({ kind: 'create', stage: s.stage })}
          >
            <Icon name="add" size={15} style={{ marginRight: 4 }} />
            Внести оплату
          </button>
        )}
      </motion.div>
    );
  };

  const onSiteAll = summary.onSite.payments;
  const onSiteVisible = onSiteExpanded ? onSiteAll : onSiteAll.slice(0, ON_SITE_PAGE_SIZE);

  return (
    <div className="payments-section">
      <div className="payments-section-header">
        <div className="payments-section-title">Финансы</div>
        <div className="payments-totals">
          <div><span>Всего по договору</span><strong>{formatMoney(summary.totals.planned)}</strong></div>
          <div><span>Оплачено</span><strong className="text-success">{formatMoney(summary.totals.paid)}</strong></div>
          {parseFloat(summary.totals.pending) > 0 && (
            <div><span>На одобрении</span><strong className="text-warning">{formatMoney(summary.totals.pending)}</strong></div>
          )}
          <div><span>Остаток</span><strong>{formatMoney(summary.totals.remaining)}</strong></div>
          {parseFloat(summary.totals.overdueAmount) > 0 && (
            <div><span>Просрочено</span><strong className="text-danger">{formatMoney(summary.totals.overdueAmount)}</strong></div>
          )}
        </div>
      </div>

      <div className="payments-block-title">График платежей</div>
      <div className="payment-stage-grid">
        {summary.stages.map(renderStageCard)}
      </div>

      {/*
        ТЗ «Разделение воронок» — «Расходы на месте» ведёт только китайский
        офис (LIVING_EXPENSES вне STAGE_OFFICE Таджикистана). summary.onSiteVisible
        уже отражает решение сервера (payments.service.ts canSeeStage): для
        таджикского менеджера этот блок скрываем ЦЕЛИКОМ, а не показываем с
        нулями. Ноль читается как факт «трат нет», хотя на деле это «вам не
        положено это видеть» — два разных сообщения нельзя путать местами,
        поэтому решение показывать/не показывать принимает флаг, а не суммы.
      */}
      {summary.onSiteVisible && (
        <>
          <div className="payments-block-title">Расходы на месте</div>
          <div className="payments-onsite">
            <div className="payments-onsite-totals">
              <div><span>Всего</span><strong>{formatMoney(summary.onSite.total)}</strong></div>
              <div><span>Проживание</span><strong>{formatMoney(summary.onSite.byPurpose.ACCOMMODATION)}</strong></div>
              <div><span>Питание</span><strong>{formatMoney(summary.onSite.byPurpose.FOOD)}</strong></div>
              <div><span>Другое</span><strong>{formatMoney(summary.onSite.byPurpose.OTHER)}</strong></div>
            </div>

            {onSiteAll.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>Расходов на месте пока нет</div>
            ) : (
              <div className="payment-rows">
                {onSiteVisible.map(renderPaymentRow)}
              </div>
            )}
            {onSiteAll.length > ON_SITE_PAGE_SIZE && !onSiteExpanded && (
              <button className="btn btn-sm btn-secondary" onClick={() => setOnSiteExpanded(true)}>
                Показать ещё ({onSiteAll.length - ON_SITE_PAGE_SIZE})
              </button>
            )}

            {canAddPayment && (
              <button
                type="button"
                className="btn btn-sm btn-secondary payment-stage-add-btn"
                onClick={() => setModal({ kind: 'create', stage: 'LIVING_EXPENSES' })}
              >
                <Icon name="add" size={15} style={{ marginRight: 4 }} />
                + Расход
              </button>
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {modal?.kind === 'create' && (
          <PaymentFormModal key="create" studentId={studentId} stage={modal.stage} onClose={() => setModal(null)} onSaved={load} />
        )}
        {modal?.kind === 'edit' && (
          <PaymentFormModal
            key="edit"
            studentId={studentId}
            stage={modal.payment.stage}
            payment={modal.payment}
            onClose={() => setModal(null)}
            onSaved={load}
          />
        )}
        {modal?.kind === 'schedule' && (
          <ScheduleEditModal
            key="schedule"
            studentId={studentId}
            stage={modal.stage}
            current={modal.current}
            onClose={() => setModal(null)}
            onSaved={load}
          />
        )}
        {modal?.kind === 'reject' && (
          <PaymentReasonPrompt
            key="reject"
            title="Отклонить платёж"
            message="Причина обязательна — менеджер увидит её и сможет исправить данные."
            confirmText="Отклонить"
            danger
            onCancel={() => setModal(null)}
            onConfirm={onConfirmReject}
          />
        )}
        {modal?.kind === 'void' && (
          <PaymentReasonPrompt
            key="void"
            title="Аннулировать платёж"
            message="Проведённый платёж перестанет учитываться в суммах. Действие необратимо (сторно, не удаление)."
            confirmText="Аннулировать"
            danger
            onCancel={() => setModal(null)}
            onConfirm={onConfirmVoid}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
