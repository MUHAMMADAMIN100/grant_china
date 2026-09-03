import { useState } from 'react';
import { claimVisa, withdrawVisaClaim, type StudentMe } from '../studentApi';
import Icon from '../Icon';

type Props = {
  me: StudentMe;
  onToast: (kind: 'ok' | 'err', text: string) => void;
  /** После успешного запроса кабинет перечитывает /me. */
  onChanged: () => void;
};

/**
 * 26.08.2026 — отметка о визе от студента, под индикатором статуса.
 *
 * Сам индикатор остаётся истиной из CRM: студент не переключает визу, а
 * сообщает менеджеру «получил» / «ещё нет», и тот подтверждает (решение
 * заказчика). Три состояния блока:
 *  - отметки нет → одна кнопка, противоположная текущему статусу;
 *  - отметка ждёт проверки → текст «ожидает» и «Отменить»;
 *  - последнюю отметку отклонили → причина и та же кнопка, чтобы подать снова.
 */
export default function VisaClaimControls({ me, onToast, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const pending = !!me.visaClaimedAt && !me.visaClaimReviewedAt;
  const rejected = !!me.visaClaimReviewedAt && me.visaClaimApproved === false;

  const send = async (received: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await claimVisa(received);
      onToast('ok', 'Отметка отправлена менеджеру на подтверждение');
      onChanged();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось отправить отметку');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawVisaClaim();
      onToast('ok', 'Отметка отменена');
      onChanged();
    } catch (err: any) {
      onToast('err', err?.response?.data?.message || 'Не удалось отменить отметку');
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <div className="stu-visa-claim is-pending">
        <Icon name="hourglass_top" size={18} />
        <div>
          <div>
            Вы отметили: <b>{me.visaClaimReceived ? 'визу получил' : 'визы ещё нет'}</b>
            {me.visaClaimedAt ? ` (${new Date(me.visaClaimedAt).toLocaleDateString('ru-RU')})` : ''}.
          </div>
          <div className="stu-visa-claim-sub">Ждёт подтверждения менеджера — статус выше обновится после проверки.</div>
          <button type="button" className="btn btn-outline btn-small" onClick={cancel} disabled={busy} style={{ marginTop: 8 }}>
            <Icon name="undo" size={14} /> Отменить отметку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stu-visa-claim">
      {rejected && (
        <div className="stu-visa-claim-rejected">
          <Icon name="info" size={16} />
          <div>
            Менеджер не подтвердил вашу отметку «{me.visaClaimReceived ? 'визу получил' : 'визы ещё нет'}».
            {me.visaClaimNote && <div>Причина: {me.visaClaimNote}</div>}
          </div>
        </div>
      )}
      {me.visaReceived ? (
        <button type="button" className="btn btn-outline btn-small" onClick={() => send(false)} disabled={busy}>
          <Icon name="flag" size={14} /> Визы у меня ещё нет
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-small" onClick={() => send(true)} disabled={busy}>
          <Icon name="verified" size={16} /> Я получил визу
        </button>
      )}
      <div className="stu-visa-claim-sub">
        Отметка уйдёт менеджеру на проверку; статус выше поменяется после его подтверждения.
      </div>
    </div>
  );
}
