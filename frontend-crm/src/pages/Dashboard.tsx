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
import StatTile, { type StatDetail, type StatDetailRow } from '../components/StatTile';
import StorageCard from '../components/StorageCard';

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

  /**
   * Расшифровки плиток. Пока статистика не пришла, detail не собираем —
   * плитка остаётся некликабельной вместо модалки с прочерками.
   *
   * ВАЖНО про доступ: и заявки, и студенты считаются на бэкенде В ТОМ ЖЕ
   * объёме, что видит список (менеджер — только своё, по региону), поэтому
   * ссылки отсюда всегда ведут в выборку с тем же числом строк.
   */
  const statusRows = (statuses: string[]): StatDetailRow[] =>
    statuses
      .map((s) => ({
        status: s,
        count: (appStats?.byStatus || []).reduce(
          (sum: number, row: any) => (row.status === s ? sum + (row._count || 0) : sum),
          0,
        ),
      }))
      .filter((r) => r.count > 0)
      .map((r) => ({
        label: STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] || r.status,
        value: String(r.count),
        to: `/applications?status=${r.status}`,
      }));

  const APPLICATIONS_SCOPE =
    'Считаются только живые заявки: удалённые и убранные в архив не входят — ровно как в списке заявок на вкладке «Все».';

  const statCards: Array<{
    label: string;
    value: React.ReactNode;
    color: string;
    bg: string;
    icon: string;
    detail?: StatDetail;
  }> = [
    {
      label: 'Всего заявок',
      value: appStats?.total ?? '—',
      color: '#3b82f6',
      bg: '#eff6ff',
      icon: 'assignment',
      detail: appStats && {
        meaning: 'Все заявки в работе — на любом этапе воронки, от новой до зачисления.',
        period: 'Текущее состояние базы, а не за период.',
        formula: APPLICATIONS_SCOPE,
        rowsTitle: 'По статусам — нажмите, чтобы открыть список',
        rows: [
          ...statusRows(['NEW', 'DOCS_REVIEW', 'DOCS_SUBMITTED', 'PRE_ADMISSION', 'AWAITING_PAYMENT', 'ENROLLED']),
        ],
        link: { to: '/applications', label: 'Открыть заявки' },
        note: appStats.archived
          ? `Сверх этого числа в архиве лежит ещё ${appStats.archived} — они не участвуют ни в одной плитке.`
          : undefined,
      },
    },
    {
      label: 'Новые',
      value: newCount,
      color: '#3b82f6',
      bg: '#eff6ff',
      icon: 'fiber_new',
      detail: appStats && {
        meaning: 'Заявки, которые ещё никто не взял в работу: статус «Новая заявка» не менялся ни разу.',
        period: 'Текущее состояние базы, а не за период.',
        formula: APPLICATIONS_SCOPE,
        link: { to: '/applications?status=NEW', label: 'Открыть новые' },
      },
    },
    {
      label: 'В работе',
      value: inProgress,
      color: '#f59e0b',
      bg: '#fffbeb',
      icon: 'pending_actions',
      detail: appStats && {
        meaning:
          'Заявки на промежуточных этапах воронки: их уже взяли, но до зачисления ещё не довели. Это не один статус, а четыре сразу.',
        period: 'Текущее состояние базы, а не за период.',
        formula: APPLICATIONS_SCOPE,
        rowsTitle: 'Какие этапы сюда входят',
        rows: statusRows(['DOCS_REVIEW', 'DOCS_SUBMITTED', 'PRE_ADMISSION', 'AWAITING_PAYMENT']),
        note: 'В списке заявок статусы фильтруются по одному — нажмите нужную строку выше, чтобы открыть именно её.',
      },
    },
    {
      label: 'Зачислено',
      value: enrolled,
      color: '#10b981',
      bg: '#ecfdf5',
      icon: 'task_alt',
      detail: appStats && {
        meaning: 'Заявки, доведённые до конца: студент зачислен в университет.',
        period: 'Текущее состояние базы, а не за период.',
        formula: APPLICATIONS_SCOPE,
        link: { to: '/applications?status=ENROLLED', label: 'Открыть зачисленных' },
      },
    },
    {
      label: 'Всего студентов',
      value: stuStats?.total ?? '—',
      color: '#d52b2b',
      bg: '#fff0f0',
      icon: 'school',
      detail: stuStats && {
        meaning: 'Карточки студентов в системе — все, кто дошёл до договора и ведётся дальше.',
        period: 'Текущее состояние базы, а не за период.',
        formula: 'Удалённые карточки не считаются. Менеджер видит здесь только своих студентов, руководство — всех.',
        rowsTitle: 'По кабинетам — нажмите, чтобы открыть список',
        rows: (stuStats.byCabinet || []).map((c: any) => ({
          label: `Кабинет ${c.cabinet}`,
          value: String(c._count),
          to: `/students?cabinet=${c.cabinet}`,
        })),
        link: { to: '/students', label: 'Открыть студентов' },
      },
    },
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
          <StatTile
            key={c.label}
            label={c.label}
            value={c.value}
            color={c.color}
            bg={c.bg}
            icon={c.icon}
            detail={c.detail}
          />
        ))}
      </motion.div>

      {/* ТЗ 5.2 «интерфейс сотрудника». Показываем всем, у кого вообще
          бывает расчётный лист: payslips.service.generate() создаёт листы для
          EMPLOYEE и ADMIN (FOUNDER исключён — у него не зарплата, а прибыль).
          Раньше условие было `role === 'EMPLOYEE'`, и администратор не видел
          на дашборде собственную зарплату, хотя лист ему начислялся. */}
      {(me?.role === 'EMPLOYEE' || me?.role === 'ADMIN') && <MyPayrollWidget />}

      {/* 07.09.2026 — «Диск сервера»: можно ли сейчас загружать файлы и сколько
          места осталось. Уборка сирот — только Основателю. */}
      {(me?.role === 'FOUNDER' || me?.role === 'ADMIN') && <StorageCard canPurge={me?.role === 'FOUNDER'} />}

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
