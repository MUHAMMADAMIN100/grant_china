import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { applicationStats } from '../api/applications';
import { studentStats } from '../api/students';
import { getMyKpi, getMyPreview } from '../api/payroll';
import type { PayrollMyKpi, PayrollPreview } from '../api/types';
import { DIRECTION_LABEL, STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { currentMonthKey } from '../utils/datetime';
import { formatMoney, formatPercent } from '../utils/money';
import { fadeUp, staggerContainer, listItem } from '../motion';
import Icon from '../Icon';

/**
 * ТЗ 5.2 «интерфейс сотрудника» — компактный виджет своих KPI и предварительного
 * итога зарплаты за текущий месяц прямо на дашборде, со ссылкой на полную
 * страницу /my-payroll. Только СВОИ данные (userId берётся на бэкенде из JWT).
 */
function MyPayrollWidget() {
  const [kpi, setKpi] = useState<PayrollMyKpi | null>(null);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);

  useEffect(() => {
    const period = currentMonthKey();
    getMyKpi(period).then(setKpi).catch(() => {});
    getMyPreview(period).then(setPreview).catch(() => {});
  }, []);

  if (!kpi || !preview) return null;

  return (
    <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
      <div className="card-header">
        <h2 className="card-title">Моя зарплата за текущий месяц</h2>
        <Link to="/my-payroll" className="btn btn-sm btn-secondary">Подробнее</Link>
      </div>
      <div className="card-body">
        <div className="receipt-dropzone-hint" style={{ marginBottom: 10 }}>
          Предварительный расчёт — итог может измениться до утверждения руководством.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div><div className="stat-label">Лиды / консультации</div><strong>{kpi.leadsProcessed} / {kpi.consultationsHeld}</strong></div>
          <div><div className="stat-label">Конверсия в договор</div><strong>{formatPercent(kpi.conversionRate)}</strong></div>
          <div><div className="stat-label">Своевременность оплат</div><strong>{formatPercent(kpi.timelinessRate)}</strong></div>
          <div><div className="stat-label">Зачислено / переехало</div><strong>{kpi.enrolledCount} / {kpi.relocatedCount}</strong></div>
        </div>
        <div className="payments-totals">
          <div><span>Оклад</span><strong>{formatMoney(preview.baseAmount)}</strong></div>
          <div><span>Бонус + премия KPI</span><strong className="text-success">{formatMoney((parseFloat(preview.bonusAmount) + parseFloat(preview.kpiBonusAmount)).toFixed(2))}</strong></div>
          <div><span>Итого (предварительно)</span><strong style={{ fontSize: 18 }}>{formatMoney(preview.totalAmount)}</strong></div>
        </div>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const me = useAuth((s) => s.user);
  const [appStats, setAppStats] = useState<any>(null);
  const [stuStats, setStuStats] = useState<any>(null);

  useEffect(() => {
    applicationStats().then(setAppStats).catch(() => {});
    studentStats().then(setStuStats).catch(() => {});
  }, []);

  // Считаем по АКТУАЛЬНЫМ статусам воронки. Раньше здесь искались
  // 'IN_PROGRESS' и 'COMPLETED' — легаси-значения, которые PrismaService
  // мигрирует в DOCS_REVIEW/ENROLLED при каждом старте приложения. В базе их
  // не остаётся, ни одна строка кода их больше не пишет, и обе карточки
  // показывали ноль всегда. Считаем группами, а не одним статусом: «в работе»
  // это любой промежуточный этап воронки, а не один конкретный.
  const countByStatus = (statuses: string[]): number =>
    (appStats?.byStatus || []).reduce(
      (sum: number, s: any) => (statuses.includes(s.status) ? sum + (s._count || 0) : sum),
      0,
    );
  const newCount = countByStatus(['NEW']);
  const inProgress = countByStatus(['DOCS_REVIEW', 'DOCS_SUBMITTED', 'PRE_ADMISSION', 'AWAITING_PAYMENT']);
  // COMPLETED оставлен в списке как страховка на случай, если миграция
  // легаси-статусов почему-то не отработала на конкретной базе.
  const enrolled = countByStatus(['ENROLLED', 'COMPLETED']);

  const statCards = [
    { label: 'Всего заявок', value: appStats?.total ?? '—', color: '#3b82f6', bg: '#eff6ff', icon: 'assignment' },
    { label: 'Новые', value: newCount, color: '#3b82f6', bg: '#eff6ff', icon: 'fiber_new' },
    { label: 'В работе', value: inProgress, color: '#f59e0b', bg: '#fffbeb', icon: 'pending_actions' },
    { label: 'Зачислено', value: enrolled, color: '#10b981', bg: '#ecfdf5', icon: 'task_alt' },
    { label: 'Всего студентов', value: stuStats?.total ?? '—', color: '#d52b2b', bg: '#fff0f0', icon: 'school' },
  ];

  return (
    <>
      <motion.div
        className="stats-grid"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {statCards.map((c) => (
          <motion.div
            key={c.label}
            className="stat-card"
            variants={fadeUp}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
          >
            <div className="stat-icon-row">
              <div>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value" style={c.color ? { color: c.color } : undefined}>
                  {c.value}
                </div>
              </div>
              <motion.div
                className="stat-icon"
                style={{ background: c.bg, color: c.color }}
                whileHover={{ scale: 1.15, rotate: 8 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Icon name={c.icon} size={24} />
              </motion.div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ТЗ 5.2 «интерфейс сотрудника». Показываем всем, у кого вообще
          бывает расчётный лист: payslips.service.generate() создаёт листы для
          EMPLOYEE и ADMIN (FOUNDER исключён — у него не зарплата, а прибыль).
          Раньше условие было `role === 'EMPLOYEE'`, и администратор не видел
          на дашборде собственную зарплату, хотя лист ему начислялся. */}
      {(me?.role === 'EMPLOYEE' || me?.role === 'ADMIN') && <MyPayrollWidget />}

      <motion.div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Заявки по направлениям</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(appStats?.byDirection || []).map((d: any) => (
              <motion.div
                key={d.direction}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>{DIRECTION_LABEL[d.direction as keyof typeof DIRECTION_LABEL]}</span>
                <strong>{d._count}</strong>
              </motion.div>
            ))}
            {!appStats?.byDirection?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>

        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Студенты по кабинетам</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(stuStats?.byCabinet || []).map((c: any) => (
              <motion.div
                key={c.cabinet}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>Кабинет {c.cabinet}</span>
                <strong>{c._count}</strong>
              </motion.div>
            ))}
            {!stuStats?.byCabinet?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>

        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Статусы заявок</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(appStats?.byStatus || []).map((s: any) => (
              <motion.div
                key={s.status}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>{STATUS_LABEL[s.status as keyof typeof STATUS_LABEL]}</span>
                <strong>{s._count}</strong>
              </motion.div>
            ))}
            {!appStats?.byStatus?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
