import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { assignApplicationManager, clearRepeatApplication, deleteApplication, getApplication, updateApplication } from '../api/applications';
import { getStudent, updateStudent, uploadPhoto } from '../api/students';
import { listContracts } from '../api/contracts';
import type { Application, ApplicationStatus, Contract, Direction, Student, StudentStatus } from '../api/types';
import { APPLICATION_STAGES, DIRECTION_LABEL, LEAD_SOURCES, STAGE_INDEX, STATUS_BADGE, STATUS_LABEL, STATUS_SHORT, STUDENT_STATUS_LABEL, canWriteFinance, isPrivileged, leadSourceLabel } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import DocumentsChecklist from '../components/DocumentsChecklist';
import DirectionOptions from '../components/DirectionOptions';
import ManagerBar from '../components/ManagerBar';
import ApplicationFormSection from '../components/ApplicationFormSection';
import BackButton from '../components/BackButton';
import CommentsFeed from '../components/CommentsFeed';
import CallsCard from '../components/CallsCard';
import ContractStatusBadge from '../components/ContractStatusBadge';
import ContractFormModal from '../components/ContractFormModal';
import Icon from '../Icon';
import { AnimatePresence, motion } from 'framer-motion';
import { compose, email as emailRule, hasErrors, maxLen, minLen, numberRule, required, validateAll } from '../utils/validators';
import { runOptimistic } from '../utils/optimistic';

import { buildFileUrl } from '../utils/fileUrl';

/**
 * Изменились ли поля карточки студента, которыми владеет форма на этой
 * странице (та же проверка и с тем же обоснованием есть в StudentDetail.tsx).
 *
 * RealtimeGateway не исключает отправителя и не передаёт автора события
 * (backend/src/realtime/realtime.gateway.ts шлёт только { id, studentId }),
 * поэтому назначенный менеджер получает эхо и СВОИХ действий: правит телефон,
 * не сохраняя грузит скан — document:uploaded прилетает ему же. Без этой
 * проверки он видел бы «обновлено другим пользователем», хотя никто другой
 * ничего не менял. Сравниваем ровно те поля, из-за которых подсказка нужна.
 */
function cardFieldsDiffer(prev: Student | null, next: Student): boolean {
  if (!prev) return false;
  return (
    prev.fullName !== next.fullName ||
    prev.phones.join(',') !== next.phones.join(',') ||
    (prev.email || '') !== (next.email || '') ||
    prev.direction !== next.direction ||
    prev.cabinet !== next.cabinet ||
    prev.status !== next.status ||
    (prev.comment || '') !== (next.comment || '')
  );
}

/**
 * Значения формы карточки из серверного снимка студента.
 *
 * Одна функция на два места (первичная загрузка и успешное сохранение) —
 * раньше после сохранения форму переливал reload(), то есть ЛИШНИЙ GET ради
 * нормализации того, что сервер уже вернул в ответе на PATCH. Разъехаться
 * набору полей теперь неоткуда.
 */
function formFromStudent(s: Student) {
  return {
    fullName: s.fullName,
    phones: s.phones.join(', '),
    email: s.email || '',
    direction: s.direction,
    cabinet: s.cabinet,
    status: s.status,
    comment: s.comment || '',
  };
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [app, setApp] = useState<Application | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>(null);
  // reload() асинхронный, и решение «переливать ли форму» принимается уже
  // ПОСЛЕ await — к этому моменту значения edit/form из замыкания того рендера,
  // в котором reload был создан (realtime-подписка, onChange у
  // DocumentsChecklist), успевают устареть. Рефы всегда отдают актуальное.
  const editRef = useRef(false);
  editRef.current = edit;
  const formRef = useRef<any>(null);
  formRef.current = form;
  // Прошлый серверный снимок карточки студента — по той же причине через реф:
  // сравнение происходит после await, где `student` из замыкания уже устарел.
  const studentRef = useRef<Student | null>(null);
  studentRef.current = student;
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Раздел 5 ТЗ (волна 6) — договор, оформленный по ЭТОЙ заявке (атрибуция
  // конверсии «лид → договор»). У студента договоров может быть несколько
  // (расторгли и подписали заново), поэтому ищем именно связанный с app.id.
  const [contract, setContract] = useState<Contract | null>(null);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  // ТЗ 3.1 — источник привлечения правится вручную именно здесь:
  // ensureApplication сознательно создаёт заявку с source = null в расчёте на
  // карточку, и без этого контрола поле у целого класса заявок оставалось бы
  // пустым навсегда, а отчёт по каналам привлечения не собирался.
  // Состояние отдельное от form: блок обязан работать и в ветке isNew, где
  // карточки студента (и самой form) ещё нет.
  // Отдельного флага «идёт сохранение» здесь нет намеренно: редактор
  // закрывается сразу с новым значением, а при отказе сервера возвращается
  // с тем же набранным текстом (см. onSaveSource).
  const [sourceEdit, setSourceEdit] = useState<{ source: string; sourceDetail: string } | null>(null);

  const formErrors = form
    ? validateAll(
        { fullName: form.fullName, phones: form.phones, email: form.email, cabinet: form.cabinet, comment: form.comment },
        {
          fullName: compose(required('Введите ФИО'), minLen(2), maxLen(100)),
          phones: (v) => {
            const s = String(v ?? '').trim();
            if (!s) return undefined;
            const parts = s.split(',').map((p: string) => p.trim()).filter(Boolean);
            for (const p of parts) {
              const digits = p.replace(/\D/g, '');
              if (digits.length < 7) return `Номер «${p}» слишком короткий (мин. 7 цифр)`;
              if (digits.length > 15) return `Номер «${p}» слишком длинный (макс. 15 цифр)`;
            }
            return undefined;
          },
          email: emailRule(),
          cabinet: numberRule({ min: 1, max: 99, integer: true }),
          comment: maxLen(2000),
        },
      )
    : {};
  const showErr = (k: string) => touched[k] && (formErrors as any)[k];

  /**
   * Окно подавления подсказки «обновлено другим пользователем».
   *
   * RealtimeGateway намеренно не исключает отправителя, поэтому автор
   * изменения получает эхо СВОЕГО же действия. Сравнения полей (prev vs s)
   * для отсечения эха мало: собственное сохранение как раз и меняет поля, то
   * есть упрёк в чужой правке приходил ровно после своей. Взводим окно перед
   * каждой своей мутацией — 5 секунд с запасом покрывают путь
   * «HTTP-ответ → сокет → reload».
   */
  const selfMutationUntilRef = useRef(0);
  const markSelfMutation = () => {
    selfMutationUntilRef.current = Date.now() + 5000;
  };

  /**
   * opts.resetForm — ЯВНОЕ разрешение перезалить форму данными сервера.
   * Передаётся только там, где сброс задуман: первичная загрузка по id,
   * успешное сохранение и кнопка «Отмена».
   * opts.external — вызов пришёл от realtime-события, а не напрямую от
   * действия пользователя. Само по себе это НЕ значит «правил кто-то другой»
   * (см. cardFieldsDiffer), нужно только чтобы решить, показывать ли подсказку.
   */
  const reload = async (opts?: { resetForm?: boolean; external?: boolean }) => {
    if (!id) return;
    // ПРОБЛЕМА F аудита: раньше error не сбрасывался на успешном пути. Роут
    // /applications/:id не размонтируется при смене :id, поэтому одна ошибка
    // (например realtime дёрнул reload() для заявки, доступ к которой уже
    // закрыт) навсегда вешала баннер поверх ВСЕХ последующих заявок.
    // Сбрасываем в начале каждого вызова — успешная загрузка следующей
    // заявки уберёт баннер предыдущей ошибки.
    setError(null);
    try {
      const a = await getApplication(id);
      setApp(a);
      if (a.studentId) {
        try {
          // Заявка и студент — разные записи с разными managerId/chinaManagerId
          // (БАГ 2 аудита). Отдельный try/catch: если доступ к самому студенту
          // почему-то закрыт (редкий рассинхрон менеджеров), не роняем всю
          // страницу заявки — просто не показываем блок студента.
          const s = await getStudent(a.studentId);
          const prev = studentRef.current;
          // Данные карточки обновляем ВСЕГДА (иначе загруженный документ не
          // появится в чек-листе), а форму переливаем только когда это
          // задумано. Раньше setForm был безусловным: менеджер правил ФИО и
          // телефон, не закрывая режим редактирования грузил скан паспорта —
          // DocumentsChecklist дёргал onChange={reload}, введённое молча
          // заменялось серверным, и «Сохранить» возвращал старые значения.
          setStudent(s);
          if (opts?.resetForm || !formRef.current || !editRef.current) {
            setForm(formFromStudent(s));
          } else if (opts?.external && Date.now() > selfMutationUntilRef.current && cardFieldsDiffer(prev, s)) {
            toast('Карточка обновлена другим пользователем — ваши правки сохранены', 'info');
          }
        } catch {
          setStudent(null);
        }
        try {
          // Договоров у студента может быть несколько — берём привязанный
          // именно к этой заявке (applicationId НЕ @unique, см. contracts.service.ts).
          const contracts = await listContracts({ studentId: a.studentId, pageSize: 50 });
          const forThisApp = contracts.items
            .filter((c) => c.applicationId === a.id)
            .sort((x, y) => new Date(y.signedAt || y.createdAt).getTime() - new Date(x.signedAt || x.createdAt).getTime());
          setContract(forThisApp[0] ?? null);
        } catch {
          setContract(null);
        }
      } else {
        setStudent(null);
        setContract(null);
      }
    } catch (e: any) {
      setApp(null);
      setStudent(null);
      setContract(null);
      setError(e?.response?.data?.message || 'Нет доступа к этой заявке');
    }
  };

  // Смена :id — единственный случай, когда форму обязательно перезалить:
  // иначе в ней остались бы данные студента предыдущей заявки.
  useEffect(() => { reload({ resetForm: true }); }, [id]);

  useRealtime({
    'contract:updated': (data: any) => {
      if (data?.studentId && data.studentId === app?.studentId) reload({ external: true });
    },
    'application:updated': (data: any) => {
      // Бэкенд переходит на «тонкие» realtime-события: вместо всего объекта
      // { application: {...} } может прийти { id } / { applicationId } без
      // вложенной заявки. Поддерживаем оба варианта; если событие не
      // сообщает ни applicationId, ни studentId — перезагружаем в любом
      // случае (reload() дешёвый, доступ всё равно перепроверит backend).
      const applicationId = data?.id ?? data?.applicationId ?? data?.application?.id;
      const studentId = data?.studentId ?? data?.application?.studentId;
      if (applicationId === undefined && studentId === undefined) { reload({ external: true }); return; }
      if (applicationId === id || studentId === app?.studentId) reload({ external: true });
    },
    'student:updated': (data: any) => {
      if (data?.studentId && data.studentId === app?.studentId) reload({ external: true });
    },
    'document:uploaded': (data: any) => {
      if (data?.studentId === app?.studentId) reload({ external: true });
    },
    'document:deleted': (data: any) => {
      if (data?.studentId === app?.studentId) reload({ external: true });
    },
    'form:updated': (data: any) => {
      if (data?.studentId === app?.studentId) reload({ external: true });
    },
  });

  const onStatus = async (status: ApplicationStatus) => {
    if (!id) return;
    try {
      markSelfMutation();
      await updateApplication(id, { status });
      // Подсказки для двух переходов, у которых есть побочный эффект, о
      // котором менеджеру важно знать. Раньше здесь проверялись легаси-статусы
      // IN_PROGRESS/COMPLETED, которые CRM больше не отправляет вовсе — обе
      // ветки были недостижимы, и менеджер не узнавал, что при переводе на
      // «Документы на проверке» ему автоматически создали карточку студента.
      if (status === 'DOCS_REVIEW') {
        toast('Заявка взята в работу. Карточка студента создана.', 'success');
      }
      if (status === 'ENROLLED') {
        toast('Студент зачислен. Этап 2.1 в разделе «Финансы» разблокирован.', 'success');
      }
      await reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка изменения статуса', 'error');
    }
  };

  const onReassign = async (patch: { managerId?: string | null; chinaManagerId?: string | null }) => {
    if (!id || !app) return;
    let failure: unknown = null;
    markSelfMutation();
    const saved = await runOptimistic<Application, Application>({
      current: app,
      // Предсказываем только сами id: ФИО нового менеджера знает сервер, а
      // ManagerBar отдаёт наверх лишь выбранный userId. Зато права на заявке
      // (isMine → canAct) пересчитываются мгновенно, а подпись под слотом
      // придёт с ответом. Выигрыш всё равно есть: было PATCH + полный
      // reload() всей страницы (заявка + студент + договор), стал один PATCH.
      optimistic: (prev) => ({ ...prev, ...patch }),
      commit: setApp,
      request: () => assignApplicationManager(id, patch),
      // Мутации отдают заявку тем же составом связей, что и GET (MANAGER_INCLUDE),
      // но льём поверх снимка: ключи, которых в ответе не окажется, не обнулятся.
      reconcile: (prev, srv) => ({ ...prev, ...srv }),
      onError: (_msg, e) => { failure = e; },
    });
    // ManagerBar сам показывает и успех, и причину отказа, и снимает свой
    // индикатор сохранения — поэтому ошибку не глотаем, а возвращаем ему
    // исходной: сообщение бэкенда лежит в e.response.data.message, обёртка
    // превратила бы его в общее «Ошибка переназначения».
    if (!saved) throw failure ?? new Error('Ошибка переназначения');
  };

  const onDeleteApp = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Удалить заявку',
      message: student
        ? 'Заявка будет удалена вместе с карточкой студента и всеми документами.'
        : 'Заявка будет удалена. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteApplication(id);
      toast('Заявка удалена', 'success');
      navigate('/applications');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  const onSave = async () => {
    if (!student || !form) return;
    setTouched({ fullName: true, phones: true, email: true, cabinet: true, comment: true });
    if (hasErrors(formErrors)) {
      toast('Исправьте ошибки в форме', 'error');
      return;
    }
    const phones = form.phones.split(',').map((p: string) => p.trim()).filter(Boolean);
    const payload = {
      fullName: form.fullName.trim(),
      phones,
      email: form.email?.trim() || undefined,
      direction: form.direction,
      cabinet: parseInt(form.cabinet, 10),
      status: form.status,
      comment: form.comment?.trim() || undefined,
    };
    markSelfMutation();
    const saved = await runOptimistic<Student, Student>({
      current: student,
      optimistic: (prev) => ({
        ...prev,
        ...payload,
        // undefined в payload значит «поле не отправляем»: axios его не
        // сериализует, и бэкенд (dto.email !== undefined) колонку не трогает.
        // Значит и локально оно обязано остаться прежним — иначе очищенный
        // email пропадал бы с экрана и возвращался с ответом сервера.
        email: payload.email ?? prev.email,
        comment: payload.comment ?? prev.comment,
      }),
      commit: setStudent,
      request: () => updateStudent(student.id, payload),
      // Льём ответ ПОВЕРХ снимка, а не заменяем им карточку целиком: в
      // student висят documents и applicationForm, на которых держатся
      // чек-лист и анкета ниже по странице. Пока сервер их возвращает, но
      // стоит облегчить ответ PATCH — и чек-лист опустел бы молча.
      reconcile: (prev, srv) => ({ ...prev, ...srv }),
      onError: (msg) => toast(msg, 'error'),
    });
    // Отказ сервера: карточка уже откачена, а режим редактирования НЕ
    // закрываем — введённое остаётся на экране, человек правит и жмёт снова.
    if (!saved) return;
    toast('Данные сохранены', 'success');
    // Форму переливаем ответом сервера (а не своим payload) — так в полях
    // оказываются канонические значения: телефоны в том виде, в каком их
    // сохранил бэкенд, кабинет, подставленный по направлению. Раньше ради
    // этого делался лишний reload() всей страницы.
    setForm(formFromStudent(saved));
    setEdit(false);
    setTouched({});
  };

  const onSaveSource = async () => {
    if (!id || !app || !sourceEdit) return;
    // Снимок набранного — по нему восстанавливаем редактор, если сервер
    // откажет: перенабирать уточнение из-за чужой сетевой ошибки человек
    // не должен.
    const typed = sourceEdit;
    const patch = {
      // «Не указан» отправляем именно как null, а не undefined: undefined
      // axios не сериализует, бэкенд поле не трогает — ошибочно
      // проставленный источник нельзя было снять вообще, а тост при этом
      // рапортовал об успехе. null проходит валидацию (@IsOptional в
      // UpdateApplicationDto пропускает и null, и undefined, до
      // @IsIn(LEAD_SOURCE_VALUES) дело не доходит) и обнуляет колонку —
      // «неизвестно» в схеме выражается ровно через source = null
      // (common/lead-source.ts).
      source: typed.source || null,
      sourceDetail: typed.sourceDetail.trim(),
    };
    markSelfMutation();
    // Редактор закрываем сразу: пока он открыт, вместо бейджа с новым
    // источником видны те же самые поля ввода — оптимистичный результат
    // просто некуда показать. Отдельный флаг «Сохранение…» больше не нужен,
    // его роль играет сам изменившийся бейдж.
    setSourceEdit(null);
    const saved = await runOptimistic<Application, Application>({
      current: app,
      optimistic: (prev) => ({ ...prev, ...patch }),
      commit: setApp,
      request: () => updateApplication(id, patch),
      // Льём поверх снимка: PATCH отдаёт заявку тем же составом связей, что и
      // GET (MANAGER_INCLUDE), но если ответ когда-нибудь облегчат, вложенные
      // менеджеры и студент не пропадут с экрана.
      reconcile: (prev, srv) => ({ ...prev, ...srv }),
      onError: (msg) => {
        setSourceEdit(typed);
        toast(msg, 'error');
      },
    });
    if (saved) toast('Источник привлечения сохранён', 'success');
  };

  const onClearRepeat = async () => {
    if (!id || !app) return;
    const saved = await runOptimistic<Application, Application>({
      current: app,
      optimistic: (prev) => ({ ...prev, repeatOfId: null }),
      commit: setApp,
      request: () => clearRepeatApplication(id),
      reconcile: (prev, srv) => ({ ...prev, ...srv }),
      onError: (msg) => toast(msg, 'error'),
    });
    if (saved) toast('Пометка «Повторное обращение» снята', 'success');
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !student) return;
    try {
      markSelfMutation();
      await uploadPhoto(student.id, file);
      toast('Фото загружено', 'success');
      await reload();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка загрузки', 'error');
    }
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!app) return <div className="empty">Загрузка...</div>;

  const isNew = app.status === 'NEW';
  const isEnrolled = app.status === 'ENROLLED';
  const isAdmin = isPrivileged(me?.role);
  const assigned = !!app.managerId || !!app.chinaManagerId;
  const isMine = !assigned || app.managerId === me?.id || app.chinaManagerId === me?.id;
  const canAct = isAdmin || isMine;
  const currentIdx = STAGE_INDEX[app.status] ?? 0;
  // Админ и назначенный менеджер (TJ/CN) могут редактировать заявку на любом этапе
  // — как данные студента, так и анкету.
  const canEdit = !!student && canAct;
  // Договор — это финансы, а ТЗ v3 раздел 4 (критерий приёмки №4) оставляет
  // Администратору финансовую часть строго на чтение: POST /contracts закрыт
  // @Roles(FOUNDER, EMPLOYEE). Прав на саму заявку (canEdit) здесь мало —
  // иначе Администратор жал бы «Оформить договор» и получал 403 при сохранении.
  const canCreateContract = canEdit && canWriteFinance(me?.role);
  const nextStage = APPLICATION_STAGES[currentIdx + 1];
  const prevStage = currentIdx > 0 ? APPLICATION_STAGES[currentIdx - 1] : null;

  const handleNext = async () => {
    if (!nextStage) return;
    // Гейт на "Подача документов" удалён по запросу: менеджер сам решает,
    // когда переводить заявку на следующий этап. Документы могут быть
    // переданы по другим каналам (Telegram, лично) или клиент торопит.
    // Backend тоже не блокирует этот переход (см. коммит `3293525`).
    await onStatus(nextStage);
  };

  return (
    <div>
      <BackButton fallback="/applications" />
      <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {app.fullName}
          {app.repeatOfId && (
            <span className="badge badge-warning" title="По телефону/email похоже на повторное обращение">
              Повторное
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* ТЗ 3.1 — эвристика по телефону ложно срабатывает на общем семейном
              номере (брат и сестра). Без этой кнопки заявка навсегда висела бы
              во вкладке «Архив» и искажала её счётчик. */}
          {canAct && app.repeatOfId && (
            <button className="btn btn-sm btn-secondary" onClick={onClearRepeat} title="Снять пометку «Повторное обращение»">
              Не повторное
            </button>
          )}
          {canEdit && !edit && (
            <button className="btn btn-sm btn-secondary" onClick={() => setEdit(true)}>
              Редактировать
            </button>
          )}
          {canEdit && edit && (
            <>
              {/* resetForm ОБЯЗАТЕЛЕН: здесь откат правок — это и есть смысл кнопки. */}
              <button className="btn btn-sm btn-secondary" onClick={() => { setEdit(false); reload({ resetForm: true }); }}>Отмена</button>
              <button className="btn btn-sm btn-primary" onClick={onSave}>Сохранить</button>
            </>
          )}
          {canAct && (
            <button className="btn btn-sm btn-danger" onClick={onDeleteApp}>Удалить</button>
          )}
        </div>
      </div>

      {/* Пошаговая воронка статусов — скрываем когда заявка зачислена */}
      {!isEnrolled && (
        <div className="stage-bar">
          <div className="stage-bar-track">
            {APPLICATION_STAGES.map((stage, i) => {
              const done = i < currentIdx;
              const current = i === currentIdx;
              return (
                <div
                  key={stage}
                  className={`stage-step${done ? ' done' : ''}${current ? ' current' : ''}`}
                >
                  <div className="stage-dot">
                    {done ? <Icon name="check" size={16} /> : <span>{i + 1}</span>}
                  </div>
                  <div className="stage-label">{STATUS_SHORT[stage]}</div>
                  {i < APPLICATION_STAGES.length - 1 && <div className="stage-connector" />}
                </div>
              );
            })}
          </div>
          {canAct && (
            <div className="stage-actions">
              {prevStage && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onStatus(prevStage)}
                  title="Вернуться на предыдущий этап"
                >
                  <Icon name="arrow_back" size={16} style={{ marginRight: 4 }} />
                  Назад
                </button>
              )}
              {nextStage && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleNext}
                  title={`Перейти: ${STATUS_LABEL[nextStage]}`}
                >
                  {STATUS_LABEL[nextStage]}
                  <Icon name="arrow_forward" size={16} style={{ marginLeft: 4 }} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {isEnrolled && canAct && prevStage && (
        <div className="stage-bar" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <div className="stage-actions" style={{ marginLeft: 'auto' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => onStatus(prevStage)}
              title="Вернуться на предыдущий этап"
            >
              <Icon name="arrow_back" size={16} style={{ marginRight: 4 }} />
              Назад
            </button>
          </div>
        </div>
      )}

      <div className="card-body">
        {!isNew && (
          <ManagerBar
            manager={app.manager}
            chinaManager={app.chinaManager}
            onReassign={onReassign}
          />
        )}

        {isNew && (
          <>
            <div className="detail-row"><div className="detail-label">Телефон</div><div className="detail-value">{app.phone}</div></div>
            <div className="detail-row"><div className="detail-label">Email</div><div className="detail-value">{app.email || '—'}</div></div>
            <div className="detail-row"><div className="detail-label">Направление</div><div className="detail-value">{DIRECTION_LABEL[app.direction]}</div></div>
            <div className="detail-row"><div className="detail-label">Сообщение с сайта</div><div className="detail-value">{app.comment || '—'}</div></div>
            <div className="detail-row"><div className="detail-label">Создана</div><div className="detail-value">{new Date(app.createdAt).toLocaleString('ru-RU')}</div></div>
          </>
        )}

        {/* ТЗ 3.1 — «Источник привлечения». Блок вне веток isNew/student: у
            заявок, созданных через ensureApplication, source = null, и именно
            их менеджер обязан заполнить руками — иначе отчёт по каналам пуст. */}
        <div className="detail-row">
          <div className="detail-label">Источник привлечения</div>
          <div className="detail-value">
            {sourceEdit ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={sourceEdit.source}
                  onChange={(e) => setSourceEdit({ ...sourceEdit, source: e.target.value })}
                >
                  <option value="">Не указан</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <input
                  value={sourceEdit.sourceDetail}
                  onChange={(e) => setSourceEdit({ ...sourceEdit, sourceDetail: e.target.value })}
                  maxLength={200}
                  placeholder="Уточнение: @ник, кампания, кто порекомендовал"
                />
                <button className="btn btn-sm btn-secondary" onClick={() => setSourceEdit(null)}>
                  Отмена
                </button>
                <button className="btn btn-sm btn-primary" onClick={onSaveSource}>
                  Сохранить
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={`badge ${app.source ? 'badge-info' : 'badge-gray'}`}>{leadSourceLabel(app.source)}</span>
                {app.sourceDetail && <span>{app.sourceDetail}</span>}
                {canAct && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setSourceEdit({ source: app.source || '', sourceDetail: app.sourceDetail || '' })}
                    title="Проставить источник привлечения"
                  >
                    <Icon name="edit" size={14} style={{ marginRight: 4 }} />
                    Изменить
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {!isNew && student && form && (
          <>
            <div className="detail-grid">
              <div>
                <div className={`detail-photo${isEnrolled ? ' is-enrolled' : ''}`}>
                  {student.photoUrl
                    ? <img src={buildFileUrl(student.photoUrl)} alt="" />
                    : <Icon name="person" size={80} style={{ color: 'var(--text-light)' }} />}
                </div>
                {isEnrolled && (
                  <motion.div
                    className="enrolled-photo-badge"
                    initial={{ opacity: 0, scale: 0.9, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 250, damping: 18 }}
                    style={{ color: '#16a34a' }}
                  >
                    <Icon name="verified" size={16} style={{ color: '#16a34a' }} />
                    <span style={{ color: '#16a34a' }}>Зачислен</span>
                  </motion.div>
                )}
                {canEdit && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%', marginTop: 8 }}
                      onClick={() => photoRef.current?.click()}
                    >
                      <Icon name="photo_camera" size={18} style={{ marginRight: 6 }} />
                      Загрузить фото
                    </button>
                    <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhoto} />
                  </>
                )}
              </div>

              <div>
                {!edit ? (
                  <>
                    <div className="detail-row"><div className="detail-label">ФИО</div><div className="detail-value">{student.fullName}</div></div>
                    <div className="detail-row"><div className="detail-label">Телефоны</div><div className="detail-value">{student.phones.join(', ') || '—'}</div></div>
                    <div className="detail-row"><div className="detail-label">Email</div><div className="detail-value">{student.email || '—'}</div></div>
                    <div className="detail-row"><div className="detail-label">Направление</div><div className="detail-value">{DIRECTION_LABEL[student.direction]}</div></div>
                    <div className="detail-row"><div className="detail-label">Кабинет</div><div className="detail-value">№{student.cabinet}</div></div>
                    <div className="detail-row"><div className="detail-label">Статус студента</div><div className="detail-value">{STUDENT_STATUS_LABEL[student.status]}</div></div>
                    <div className="detail-row"><div className="detail-label">Комментарий из анкеты</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{student.comment || '—'}</div></div>
                    <div className="detail-row"><div className="detail-label">Создана заявка</div><div className="detail-value">{new Date(app.createdAt).toLocaleString('ru-RU')}</div></div>
                  </>
                ) : (
                  <>
                    <div className="form-group">
                      <label>ФИО *</label>
                      <input
                        value={form.fullName}
                        onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                        onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
                        className={showErr('fullName') ? 'input-error' : ''}
                        maxLength={100}
                      />
                      {showErr('fullName') && <div className="form-error-text">{(formErrors as any).fullName}</div>}
                    </div>
                    <div className="form-group">
                      <label>Телефоны (через запятую)</label>
                      <input
                        value={form.phones}
                        onChange={(e) => setForm({ ...form, phones: e.target.value.replace(/[^\d ,+\-()]/g, '') })}
                        onBlur={() => setTouched((t) => ({ ...t, phones: true }))}
                        className={showErr('phones') ? 'input-error' : ''}
                        placeholder="+992123456789, +992111222333"
                      />
                      {showErr('phones') && <div className="form-error-text">{(formErrors as any).phones}</div>}
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                        className={showErr('email') ? 'input-error' : ''}
                      />
                      {showErr('email') && <div className="form-error-text">{(formErrors as any).email}</div>}
                    </div>
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label>Направление</label>
                        <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}>
                          <DirectionOptions />
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Кабинет</label>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={form.cabinet}
                          onChange={(e) => setForm({ ...form, cabinet: e.target.value.replace(/[^\d]/g, '') })}
                          onBlur={() => setTouched((t) => ({ ...t, cabinet: true }))}
                          className={showErr('cabinet') ? 'input-error' : ''}
                        />
                        {showErr('cabinet') && <div className="form-error-text">{(formErrors as any).cabinet}</div>}
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Статус студента</label>
                      <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StudentStatus })}>
                        <option value="ACTIVE">Активный</option>
                        <option value="PAUSED">Приостановлен</option>
                        <option value="GRADUATED">Выпустился</option>
                        <option value="ARCHIVED">В архиве</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Комментарий из анкеты</label>
                      <textarea
                        value={form.comment}
                        onChange={(e) => setForm({ ...form, comment: e.target.value })}
                        onBlur={() => setTouched((t) => ({ ...t, comment: true }))}
                        maxLength={2000}
                        className={showErr('comment') ? 'input-error' : ''}
                      />
                      {showErr('comment') && <div className="form-error-text">{(formErrors as any).comment}</div>}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="detail-row">
              <div className="detail-label">Договор</div>
              <div className="detail-value">
                {contract ? (
                  <>
                    <Link to={`/contracts/${contract.id}`}>{contract.number}</Link>{' '}
                    <ContractStatusBadge status={contract.status} />
                    {contract.signedAt && ` от ${new Date(contract.signedAt).toLocaleDateString('ru-RU')}`}
                  </>
                ) : canCreateContract ? (
                  <button className="btn btn-sm btn-secondary" onClick={() => setContractModalOpen(true)}>
                    <Icon name="description" size={15} style={{ marginRight: 4 }} />
                    Оформить договор
                  </button>
                ) : (
                  '—'
                )}
              </div>
            </div>

            <DocumentsChecklist
              studentId={student.id}
              studentName={student.fullName}
              documents={student.documents || []}
              applicationForm={student.applicationForm}
              onChange={reload}
              editable={!!canEdit}
            />

            <div style={{ marginTop: 28 }}>
              <ApplicationFormSection
                studentId={student.id}
                initialForm={student.applicationForm}
                canEdit={!!canEdit}
                onSaved={reload}
              />
            </div>
          </>
        )}

        {/* ТЗ 6.2 — история звонков по лиду и click-to-call. Стоит ДО
            комментариев и вне блока `student &&`: звонить начинают ещё до
            того, как заявка превратилась в карточку студента. */}
        <CallsCard applicationId={app.id} phone={app.phone} canEdit={canAct} />

        <CommentsFeed applicationId={app.id} canAdd={canAct} />
      </div>
      </div>

      <AnimatePresence>
        {contractModalOpen && student && (
          <ContractFormModal
            key="contract-create"
            studentId={student.id}
            applications={[{ id: app.id, fullName: app.fullName, status: app.status }]}
            defaultApplicationId={app.id}
            onClose={() => setContractModalOpen(false)}
            onSaved={(c) => { setContract(c); setContractModalOpen(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
