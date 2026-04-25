import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  APPLICATION_STAGES,
  STAGE_INDEX,
  STATUS_LABEL,
  STATUS_SHORT,
  type Application,
  type ApplicationStatus,
} from '../api/types';
import { updateApplication } from '../api/applications';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Props = {
  application: Application;
  canEdit: boolean;
  onChanged?: () => void;
};

export default function ApplicationStatusStepper({ application, canEdit, onChanged }: Props) {
  const { toast } = useUI();
  const [saving, setSaving] = useState(false);

  const currentIdx = STAGE_INDEX[application.status] ?? 0;

  const change = async (next: ApplicationStatus) => {
    if (!canEdit || saving || next === application.status) return;
    setSaving(true);
    try {
      await updateApplication(application.id, { status: next });
      toast(`Статус → «${STATUS_LABEL[next]}»`, 'success');
      onChanged?.();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-stepper">
      <div className="app-stepper-head">
        <div>
          <div className="app-stepper-title">Этап поступления</div>
          <div className="app-stepper-current">
            <span className="badge badge-warning">{STATUS_LABEL[application.status]}</span>
          </div>
        </div>
        {canEdit && (
          <select
            className="app-stepper-select"
            value={application.status}
            disabled={saving}
            onChange={(e) => change(e.target.value as ApplicationStatus)}
          >
            {APPLICATION_STAGES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        )}
      </div>

      <div className="app-stepper-track" role="list">
        {APPLICATION_STAGES.map((s, i) => {
          const reached = i <= currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <button
              key={s}
              type="button"
              role="listitem"
              className={`app-stepper-step${reached ? ' reached' : ''}${isCurrent ? ' current' : ''}`}
              onClick={() => change(s)}
              disabled={!canEdit || saving}
              title={STATUS_LABEL[s]}
            >
              <motion.span
                className="app-stepper-dot"
                whileHover={canEdit ? { scale: 1.1 } : {}}
                whileTap={canEdit ? { scale: 0.9 } : {}}
              >
                {reached ? <Icon name="check" size={14} /> : i + 1}
              </motion.span>
              <span className="app-stepper-label">{STATUS_SHORT[s]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
