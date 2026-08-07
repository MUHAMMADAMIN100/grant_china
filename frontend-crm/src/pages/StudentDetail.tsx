import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assignStudentManager, deleteStudent, ensureStudentApplication, getStudent, regenerateStudentPassword, updateStudent, uploadPhoto } from '../api/students';
import { motion, AnimatePresence } from 'framer-motion';
import type { Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import DocumentsChecklist from '../components/DocumentsChecklist';
import ManagerBar from '../components/ManagerBar';
import PaymentsSection from '../components/PaymentsSection';
import ApplicationFormSection from '../components/ApplicationFormSection';
import ApplicationStatusStepper from '../components/ApplicationStatusStepper';
import DirectionOptions from '../components/DirectionOptions';
import BackButton from '../components/BackButton';
import GrantCard from '../components/GrantCard';
import ContractCard from '../components/ContractCard';
import TicketsCard from '../components/TicketsCard';
import CallsCard from '../components/CallsCard';
import CommentsFeed from '../components/CommentsFeed';
import Icon from '../Icon';
import { compose, email as emailRule, hasErrors, maxLen, minLen, numberRule, required, validateAll } from '../utils/validators';
import { runOptimistic } from '../utils/optimistic';

function CredRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="creds-row">
      <span className="creds-label">{label}:</span>
      <code className="creds-value">{value}</code>
      <button
        type="button"
        onClick={onCopy}
        className="creds-copy-btn"
        title={copied ? 'Скопировано' : 'Скопировать'}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={15} />
      </button>
    </div>
  );
}

import { buildFileUrl } from '../utils/fileUrl';

/**
 * Раздел 5 ТЗ — «Виза получена: Да / Нет».
 *
 * Переключатель, а не поле формы. Виза — это событие: менеджер отмечает её
 * в тот момент, когда её выдали, поэтому клик сохраняется сразу (PATCH ровно
 * с одним полем) и не требует входить в режим редактирования карточки.
 *
 * `canEdit` — та же проверка прав, что у остальных полей карточки (решение
 * заказчика: отдельной роли для визы нет — переключает Основатель,
 * Администратор и назначенный менеджер студента). Без прав кнопки не
 * рендерятся ВООБЩЕ, а не блокируются: кнопка, ведущая к 403, показываться
 * не должна — остаётся только индикатор.
 *
 * Цвет активной опции задан инлайном поверх .scope-btn.active: штатный
 * «активный» в этом контроле — фирменный красный (переключатель «Мои/Все»),
 * а здесь цвет несёт смысл. Зелёный «Да» / серый «Нет» читаются с одного
 * взгляда и совпадают с индикатором в списке студентов.
 */
const VISA_ACTIVE_STYLE = {
  yes: { background: '#16a34a', color: '#fff', boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)' },
  no: { background: '#6b7280', color: '#fff', boxShadow: 'none' },
} as const;

function VisaSwitch({
  value,
  receivedAt,
  canEdit,
  saving,
  onChange,
}: {
  value: boolean;
  receivedAt: string | null;
  canEdit: boolean;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      {canEdit ? (
        <div className="scope-switch" role="group" aria-label="Виза получена">
          <button
            type="button"
            className={`scope-btn${value ? ' active' : ''}`}
            disabled={saving}
            aria-pressed={value}
            onClick={() => onChange(true)}
            style={{ ...(value ? VISA_ACTIVE_STYLE.yes : null), opacity: saving ? 0.6 : 1 }}
          >
            <Icon name="verified" size={16} />
            Да
          </button>
          <button
            type="button"
            className={`scope-btn${!value ? ' active' : ''}`}
            disabled={saving}
            aria-pressed={!value}
            onClick={() => onChange(false)}
            style={{ ...(!value ? VISA_ACTIVE_STYLE.no : null), opacity: saving ? 0.6 : 1 }}
          >
            <Icon name="schedule" size={16} />
            Нет
          </button>
        </div>
      ) : (
        <span className={`badge ${value ? 'badge-success' : 'badge-gray'}`} style={{ gap: 4 }}>
          <Icon name={value ? 'verified' : 'schedule'} size={14} />
          {value ? 'Получена' : 'Не получена'}
        </span>
      )}
      {/* Дату показываем только при «Да»: при снятой отметке сервер обнуляет
          visaReceivedAt, и строка «отмечено ...» рядом с «Нет» вводила бы
          в заблуждение. */}
      {value && receivedAt && (
        <div style={{ color: 'var(--text-soft)', fontSize: 12, marginTop: 6 }}>
          Отмечено {new Date(receivedAt).toLocaleDateString('ru-RU')}
        </div>
      )}
    </div>
  );
}

/**
 * Изменились ли поля, которыми владеет форма редактирования.
 *
 * RealtimeGateway не исключает отправителя и не кладёт в payload автора
 * (backend/src/realtime/realtime.gateway.ts шлёт только { studentId }), так что
 * назначенный менеджер получает эхо и СВОИХ действий: правит телефон, не
 * сохраняя грузит фото — document:uploaded возвращается ему же. Без этой
 * проверки он видел бы «обновлено другим пользователем», хотя никто другой
 * ничего не менял, и быстро научился бы игнорировать подсказку.
 * Сравниваем ровно те поля, из-за которых подсказка нужна: если ни одно не
 * изменилось, конфликта с несохранёнными правками нет — молчим.
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
 * Значения формы редактирования, собранные из карточки.
 *
 * Отдельной функцией, потому что переливать форму приходится в трёх местах:
 * первичная загрузка (reload), кнопка «Отмена» и успешное сохранение — после
 * него состояние приходит из ответа PATCH, а не из GET. Раньше все три пути
 * шли через reload(), то есть ради заполнения полей дёргали сервер.
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

/**
 * Тело PATCH и ОДНОВРЕМЕННО предсказание результата.
 *
 * Ключи, которых в объекте нет, сервер не меняет: students.service.update()
 * проверяет каждое поле на `!== undefined`, а JSON.stringify выбрасывает
 * undefined ещё на клиенте. Отсюда правило, ради которого эта функция и
 * существует: пустой email нельзя предсказывать как пустой — запрос его не
 * несёт, сервер оставит прежний адрес, и оптимистичный прочерк через мгновение
 * отскочил бы обратно на старое значение.
 *
 * Собираем объект один раз и используем и как payload, и как патч состояния —
 * тогда предсказание совпадает с ответом сервера ПО ПОСТРОЕНИЮ. Это же условие
 * позволило убрать окно markSelfMutation() (см. комментарий у reload).
 */
function buildStudentPatch(form: any): Partial<Student> {
  const patch: Partial<Student> = {
    fullName: form.fullName.trim(),
    phones: form.phones.split(',').map((p: string) => p.trim()).filter(Boolean),
    direction: form.direction,
    cabinet: parseInt(form.cabinet, 10),
    status: form.status,
  };
  const email = form.email?.trim();
  if (email) patch.email = email;
  const comment = form.comment?.trim();
  if (comment) patch.comment = comment;
  return patch;
}

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
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
  // Прошлый серверный снимок карточки — по той же причине через реф: сравнение
  // происходит после await, где `student` из замыкания уже устарел.
  const studentRef = useRef<Student | null>(null);
  studentRef.current = student;
  const photoRef = useRef<HTMLInputElement>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // Раздел 5 ТЗ — переключатель визы сохраняется отдельным запросом, поэтому
  // и «идёт сохранение» у него своё: блокировать всю карточку ради одного
  // клика незачем, а два клика подряд по «Да»/«Нет» дали бы гонку запросов.
  const [visaSaving, setVisaSaving] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

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
   * ПОЧЕМУ ЗДЕСЬ БОЛЬШЕ НЕТ markSelfMutation().
   *
   * Раньше рядом жил ref-«окно тишины» на 5 секунд, которое глушило подсказку
   * «карточка обновлена другим пользователем». RealtimeGateway намеренно не
   * исключает отправителя из рассылки, поэтому автор изменения получает эхо
   * своего же действия; а поскольку состояние ждало ответа сервера,
   * reload({external:true}) сравнивал СТАРЫЙ снимок карточки с новым серверным.
   * Поля, естественно, отличались — собственными же правками, — и упрёк в чужой
   * правке приходил ровно после своего сохранения. Окно затыкало подсказку
   * целиком, заодно пряча настоящие чужие правки в эти 5 секунд.
   *
   * С оптимистичным обновлением подпорка не нужна: своё изменение попадает
   * в состояние ДО отправки запроса, поэтому к моменту прихода эха
   * studentRef.current уже равен тому, что вернёт сервер, и cardFieldsDiffer()
   * честно отвечает «ничего не изменилось». Условие этого — предсказание,
   * совпадающее с серверным поле в поле: см. buildStudentPatch(), где поля,
   * которых нет в запросе, не меняются и локально.
   *
   * Оставшиеся неоптимистичные пути окна не требовали никогда:
   * cardFieldsDiffer() сравнивает семь полей формы, а photoUrl (загрузка фото)
   * и applications (создание заявки) в их число не входят — эхо от них молчит
   * и без всякого подавления.
   */

  /**
   * opts.resetForm — ЯВНОЕ разрешение перезалить форму данными сервера.
   * Остался ровно один такой вызов — первичная загрузка по id: сохранение
   * и «Отмена» больше не ходят на сервер ради формы, они заливают её из уже
   * известного состояния (formFromStudent).
   * opts.external — вызов пришёл от realtime-события, а не напрямую от
   * действия пользователя. Само по себе это НЕ значит «правил кто-то другой»
   * (см. cardFieldsDiffer), нужно только чтобы решить, показывать ли подсказку.
   */
  const reload = async (opts?: { resetForm?: boolean; external?: boolean }) => {
    if (!id) return;
    // ПРОБЛЕМА F аудита: раньше error не сбрасывался на успешном пути, и после
    // одной ошибки (например realtime дёрнул reload() для карточки, доступ к
    // которой уже закрыт) баннер оставался навечно — роут /students/:id не
    // размонтируется при смене :id, а стейт компонента переживает переход.
    // Сбрасываем в начале КАЖДОГО вызова, чтобы успешная загрузка следующего
    // студента убирала баннер предыдущей ошибки.
    setError(null);
    try {
      const s = await getStudent(id);
      const prev = studentRef.current;
      // Данные карточки обновляем ВСЕГДА (иначе загруженный документ не
      // появится в чек-листе), а форму переливаем только когда это задумано.
      // Раньше setForm был безусловным: менеджер правил ФИО и телефон, не
      // закрывая режим редактирования грузил скан паспорта — DocumentsChecklist
      // дёргал onChange={reload}, введённое молча заменялось серверным, и
      // «Сохранить» записывал обратно старые значения.
      setStudent(s);
      if (opts?.resetForm || !formRef.current || !editRef.current) {
        setForm(formFromStudent(s));
      } else if (opts?.external && cardFieldsDiffer(prev, s)) {
        toast('Карточка обновлена другим пользователем — ваши правки сохранены', 'info');
      }
    } catch (e: any) {
      // БАГ 2 аудита: после закрытия доступа к чужим карточкам EMPLOYEE
      // с чужим UUID должен увидеть понятную ошибку, а не вечную «Загрузка...».
      setStudent(null);
      setError(e?.response?.data?.message || 'Нет доступа к этому студенту');
    }
  };

  // Смена :id — единственный случай, когда форму обязательно перезалить:
  // иначе в ней остались бы данные предыдущего студента.
  useEffect(() => { reload({ resetForm: true }); }, [id]);

  useRealtime({
    'student:updated': (data: any) => { if (data?.studentId === id) reload({ external: true }); },
    'document:uploaded': (data: any) => { if (data?.studentId === id) reload({ external: true }); },
    'document:deleted': (data: any) => { if (data?.studentId === id) reload({ external: true }); },
    'form:updated': (data: any) => { if (data?.studentId === id) reload({ external: true }); },
    'application:updated': (data: any) => {
      // Бэкенд переходит на «тонкие» realtime-события: вместо всего объекта
      // { application: {...} } может прийти { studentId } / { applicationId }
      // без вложенного студента. Поддерживаем оба варианта payload'а; если
      // событие вообще не сообщает, кого коснулось изменение — перезагружаем
      // в любом случае (reload() дешёвый, а доступ всё равно перепроверит backend).
      const studentId = data?.studentId ?? data?.application?.studentId;
      if (studentId === undefined || studentId === id) reload({ external: true });
    },
  });

  /**
   * Сохранение карточки — оптимистично.
   *
   * Было два похода на сервер на одну кнопку: PATCH, а следом полный GET
   * карточки, и всё это время форма стояла открытой и неотзывчивой. Второй
   * запрос не нужен в принципе: PATCH /students/:id отвечает тем же
   * STUDENT_SELECT, что и GET (документы, заявки, анкета, менеджеры), то есть
   * ответ и ЕСТЬ новое состояние карточки — reconcile кладёт его как есть.
   */
  const onSave = async () => {
    if (!id || !form || !student) return;
    setTouched({ fullName: true, phones: true, email: true, cabinet: true, comment: true });
    if (hasErrors(formErrors)) {
      toast('Исправьте ошибки в форме', 'error');
      return;
    }
    const patch = buildStudentPatch(form);
    // Режим редактирования закрываем сразу — это и есть видимая часть
    // оптимизма. form при этом НЕ трогаем: при отказе сервера человек должен
    // вернуться к своему тексту, а не набирать его заново.
    setEdit(false);
    // Типы указаны явно: setStudent принимает Student | null, и по нему
    // вывод TState «расползся» бы шире, чем нужно предикату optimistic.
    const saved = await runOptimistic<Student, Student>({
      current: student,
      optimistic: (prev) => ({ ...prev, ...patch }),
      commit: setStudent,
      request: () => updateStudent(id, patch),
      reconcile: (_before, s) => s,
      onError: (message) => {
        // Возвращаем ровно туда, где человек был: открытая форма с его вводом
        // плюс причина отказа СЕРВЕРА, а не общая «Ошибка сохранения».
        // Карточку к этому моменту runOptimistic уже откатил.
        setEdit(true);
        toast(message, 'error');
      },
    });
    if (!saved) return;
    toast('Данные сохранены', 'success');
    setTouched({});
    // Нормализованные значения (обрезанные пробелы, разложенные телефоны)
    // переливаем в форму из ответа — но только если человек не успел снова
    // войти в редактирование, иначе затёрли бы уже набранное. Через реф:
    // edit из замыкания к этому моменту устарел (см. editRef выше).
    if (!editRef.current) setForm(formFromStudent(saved));
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    try {
      // Загрузка файла осознанно осталась «ждать сервер»: имя и адрес файла
      // известны только из ответа, предсказать их нечем.
      await uploadPhoto(id, file);
      toast('Фото загружено', 'success');
      await reload();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка загрузки', 'error');
    }
  };

  /**
   * Раздел 5 ТЗ — отметка «Виза получена». Оптимистично.
   *
   * Переключатель обязан отрабатывать по клику: это событие, а не поле формы,
   * и ждать полсекунды ради перекраски «Нет» в «Да» незачем. reload() отсюда
   * убран целиком — ответ PATCH заменяет карточку сам, а значит исчезла и
   * прежняя оговорка про «reload без resetForm»: несохранённый ввод в открытой
   * форме теперь физически нечем затереть.
   */
  const onVisaChange = async (next: boolean) => {
    if (!id || !student || visaSaving) return;
    // Повторный клик по уже активной опции — не запрос: сервер бы всё равно
    // не менял visaReceivedAt, но лишний PATCH дёрнул бы realtime всем.
    if (student.visaReceived === next) return;
    setVisaSaving(true);
    const saved = await runOptimistic<Student, Student>({
      current: student,
      // Дату ставит сервер (new Date() ровно на переходе состояния), но
      // предсказываем и её: без даты строка «Отмечено ...» на мгновение
      // пропала бы и вернулась. Показывается она с точностью до дня, так что
      // расхождение часов клиента и сервера не видно, а точное значение
      // всё равно придёт следом в reconcile.
      optimistic: (prev) => ({
        ...prev,
        visaReceived: next,
        visaReceivedAt: next ? new Date().toISOString() : null,
      }),
      commit: setStudent,
      request: () => updateStudent(id, { visaReceived: next }),
      reconcile: (_before, s) => s,
      onError: (message) => toast(message, 'error'),
    });
    // visaSaving теперь не «пока не знаем результат» (результат уже на экране),
    // а защита от гонки двух PATCH при быстрых кликах «Да»/«Нет» подряд.
    setVisaSaving(false);
    if (saved) toast(next ? 'Отмечено: виза получена' : 'Отметка о визе снята', 'success');
  };

  /**
   * Переназначение менеджеров — оптимистично ровно в той части, которую
   * карточка может предсказать честно.
   *
   * ManagerBar передаёт сюда только userId: список сотрудников живёт внутри
   * него, и ФИО назначенного здесь неизвестно. Придумывать подпись нельзя —
   * в слоте на полсекунды повисло бы неверное имя, а это хуже, чем короткое
   * ожидание. Поэтому сразу двигаем идентификаторы (от них зависят права на
   * карточку), СНЯТИЕ менеджера показываем целиком — null он и есть null, —
   * а ФИО берём из ответа: PATCH /students/:id/manager возвращает того же
   * студента, что и GET, поэтому прежний второй запрос (await reload()) ушёл.
   */
  const onReassign = async (patch: { managerId?: string | null; chinaManagerId?: string | null }) => {
    if (!id || !student) return;
    let failure: any = null;
    await runOptimistic<Student, Student>({
      current: student,
      optimistic: (prev) => {
        const next: Student = { ...prev };
        if (patch.managerId !== undefined) {
          next.managerId = patch.managerId;
          if (patch.managerId === null) next.manager = null;
        }
        if (patch.chinaManagerId !== undefined) {
          next.chinaManagerId = patch.chinaManagerId;
          if (patch.chinaManagerId === null) next.chinaManager = null;
        }
        return next;
      },
      commit: setStudent,
      request: () => assignStudentManager(id, patch),
      reconcile: (_before, s) => s,
      onError: (_message, e) => { failure = e; },
    });
    // ManagerBar показывает и «менеджер обновлён», и причину отказа сам — он
    // рассчитывает, что упавший вызов БРОСИТ. runOptimistic ошибку гасит
    // (состояние к этому моменту уже откачено), поэтому пробрасываем её руками:
    // иначе после отката человек увидел бы зелёный тост «обновлён».
    if (failure) throw failure;
  };

  const onRegenerate = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Сбросить пароль студента',
      message: 'Старый пароль станет недействительным. Новый покажется один раз — передайте его студенту.',
      confirmText: 'Сбросить',
      danger: true,
    });
    if (!ok) return;
    setRegenerating(true);
    try {
      const cr = await regenerateStudentPassword(id);
      setCredentials(cr);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const copyCreds = async () => {
    if (!credentials) return;
    const text = `Логин: ${credentials.email}\nПароль: ${credentials.password}\nВход: https://grant-china-landing.vercel.app/login`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Скопировано', 'success');
    } catch {
      toast('Не удалось скопировать', 'error');
    }
  };

  const onDeleteStudent = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Удалить студента',
      message: 'Все документы будут удалены. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteStudent(id);
      toast('Студент удалён', 'success');
      navigate('/students');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  if (error) return <div className="error-banner">{error}</div>;

  // РАННЕГО ВЫХОДА ПРИ !student ЗДЕСЬ БОЛЬШЕ НЕТ — и это не косметика.
  //
  // Раньше до ответа сервера страница возвращала строку «Загрузка...». Значит
  // восемь дочерних секций (гранты, платежи, звонки, комментарии, договор,
  // билеты, документы, анкета) не были смонтированы, а каждая грузит данные
  // сама. Запросы шли строго в два круга: сперва GET /students/:id, и только
  // после его ответа — остальные. На канале с задержкой в несколько сотен
  // миллисекунд это ровно удваивало ожидание.
  //
  // Замеры на боевой БД: выборка студента с документами и заявками — 0.1–0.2 мс,
  // индексы на месте. То есть база ни при чём, всё время уходило на круговые
  // обходы по сети. Секциям, которым нужен только studentId (он известен из
  // URL сразу), ждать было незачем — теперь они стартуют одновременно.
  const loading = !student || !form;
  const isAdmin = isPrivileged(me?.role);
  const assigned = !!student?.managerId || !!student?.chinaManagerId;
  const isMine = !assigned || student?.managerId === me?.id || student?.chinaManagerId === me?.id;
  // Пока карточка не пришла, права считаем по нижней границе: привилегия роли
  // известна сразу, принадлежность студента — нет. Показать лишнюю активную
  // кнопку хуже, чем показать нужную на долю секунды позже.
  const canEdit = loading ? isAdmin : isAdmin || isMine;

  // COMPLETED — legacy-значение статуса заявки (мигрировано в ENROLLED), но
  // у части старых заявок в БД оно ещё может встречаться "как есть" —
  // без него такие студенты никогда не увидели бы разблокированным этап 2.1.
  const isEnrolled = student?.applications?.[0]?.status === 'ENROLLED' || student?.applications?.[0]?.status === 'COMPLETED';

  return (
    <div>
      <BackButton fallback="/students" />
      <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {loading ? <span className="skeleton-line" style={{ width: 220, height: 20 }} /> : student!.fullName}
          {isEnrolled && (
            <span className="enrolled-badge" title="Студент зачислен">
              <Icon name="verified" size={16} />
              Зачислен
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!loading && canEdit && !edit && <button className="btn btn-secondary btn-sm" onClick={() => setEdit(true)}>Редактировать</button>}
          {!loading && canEdit && edit && <>
            {/* Откат правок — это и есть смысл кнопки, но ради него не нужен
                поход на сервер: student уже содержит последнее известное
                серверное состояние карточки (его поддерживают и reload, и
                ответы PATCH), поэтому форму заливаем из него локально и
                мгновенно. Раньше здесь стоял reload с resetForm — то есть
                полный GET студента ради отмены редактирования. */}
            <button className="btn btn-secondary btn-sm" onClick={() => { setEdit(false); setTouched({}); setForm(formFromStudent(student!)); }}>Отмена</button>
            <button className="btn btn-primary btn-sm" onClick={onSave}>Сохранить</button>
          </>}
          {!loading && canEdit && <button className="btn btn-danger btn-sm" onClick={onDeleteStudent}>Удалить</button>}
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          // Каркас вместо пустоты: страница сразу выглядит страницей, и видно,
          // что именно догружается. Секции ниже при этом уже грузят своё.
          <>
            <div className="skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton-line" style={{ width: '65%' }} />
          </>
        ) : (
        <>
        <ManagerBar
          manager={student.manager}
          chinaManager={student.chinaManager}
          onReassign={onReassign}
        />

        {student.applications && student.applications.length > 0 ? (
          !isEnrolled && (
            <ApplicationStatusStepper
              application={student.applications[0]}
              canEdit={canEdit}
              onChanged={reload}
            />
          )
        ) : (
          canEdit && (
            <div className="app-stepper" style={{ textAlign: 'center' }}>
              <div className="app-stepper-title" style={{ marginBottom: 6 }}>
                Этап поступления
              </div>
              <div style={{ color: 'var(--text-soft)', fontSize: 13, marginBottom: 12 }}>
                У этого студента пока нет связанной заявки. Создайте её, чтобы отслеживать этапы поступления.
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    await ensureStudentApplication(student.id);
                    toast('Заявка создана', 'success');
                    reload();
                  } catch (e: any) {
                    toast(e?.response?.data?.message || 'Ошибка', 'error');
                  }
                }}
              >
                <Icon name="add" size={16} style={{ marginRight: 4 }} />
                Создать заявку
              </button>
            </div>
          )
        )}

        {isAdmin && (
          <div className="access-bar">
            <div className="access-bar-info">
              <Icon name="lock_person" size={22} />
              <div>
                <div className="access-bar-title">Доступ в личный кабинет студента</div>
                <div className="access-bar-email">
                  {student.email ? <>Логин: <b>{student.email}</b></> : 'Email не указан'}
                </div>
              </div>
            </div>
            {student.email && (
              <motion.button
                className="btn btn-sm btn-secondary"
                onClick={onRegenerate}
                disabled={regenerating}
                whileTap={{ scale: 0.95 }}
              >
                <Icon name="refresh" size={16} style={{ marginRight: 4 }} />
                {regenerating ? 'Сброс...' : 'Сбросить пароль'}
              </motion.button>
            )}
          </div>
        )}

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
                <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => photoRef.current?.click()}>
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
                <div className="detail-row"><div className="detail-label">Статус</div><div className="detail-value">{STUDENT_STATUS_LABEL[student.status]}</div></div>
                <div className="detail-row"><div className="detail-label">Комментарий из анкеты</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{student.comment || '—'}</div></div>
                <div className="detail-row"><div className="detail-label">Создан</div><div className="detail-value">{new Date(student.createdAt).toLocaleString('ru-RU')}</div></div>
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
                  <label>Статус</label>
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

            {/* Раздел 5 ТЗ — статус визы стоит ВНЕ ветки !edit/edit намеренно.
                Это не поле анкеты, которое правят «заодно со всем остальным»,
                а отдельный факт: он виден и в режиме просмотра, и в режиме
                редактирования, и переключается независимо от кнопки
                «Сохранить». Поэтому же visaReceived НЕ добавлен ни в form,
                ни в cardFieldsDiffer() — форма им не владеет, и подсказка
                «карточка обновлена другим пользователем» из-за визы не нужна. */}
            <div className="detail-row">
              <div className="detail-label">Виза получена</div>
              <div className="detail-value">
                {/* Карточка приходит по STUDENT_SELECT, где виза выбрана явно,
                    но тип поля необязательный (в облегчённом студенте внутри
                    заявки его нет). Читаем со значением по умолчанию, а не
                    через `!`: undefined означал бы «не пришло», и рисовать по
                    нему «Да» было бы прямым враньём. */}
                <VisaSwitch
                  value={student.visaReceived ?? false}
                  receivedAt={student.visaReceivedAt ?? null}
                  canEdit={canEdit}
                  saving={visaSaving}
                  onChange={onVisaChange}
                />
              </div>
            </div>
          </div>
        </div>
        </>
        )}

        {/* Секциям ниже нужен ТОЛЬКО studentId, а он известен из URL сразу.
            Поэтому они монтируются, не дожидаясь GET /students/:id, и уходят
            за своими данными ПАРАЛЛЕЛЬНО с ним — а не вторым кругом после. */}
        <GrantCard studentId={id!} canEdit={canEdit} />

        {/* ТЗ 6.2 — история звонков и click-to-call по номеру из карточки.
            Телефон нужен только кнопке набора и подставляется, когда карточка
            догрузится — сама история звонков ждать этого не обязана. */}
        <CallsCard studentId={id!} phone={student?.phones?.[0]} canEdit={canEdit} />

        <div style={{ marginTop: 28 }}>
          <PaymentsSection studentId={id!} canEdit={canEdit} />
        </div>

        <CommentsFeed studentId={id!} canAdd={canEdit} />

        {/* Ниже — секции, которым нужны САМИ данные студента: ФИО, документы,
            анкета, список заявок. Они ждут ответа по необходимости, а не
            заодно со всеми, как было раньше. */}
        {!loading && (
        <>
        {/* ТЗ «Билеты» — перелёты студента рядом с грантом: обе сущности
            отвечают на вопрос «где человек будет учиться и когда туда летит». */}
        <TicketsCard studentId={student!.id} studentName={student!.fullName} canEdit={canEdit} />

        <DocumentsChecklist
          studentId={student!.id}
          studentName={student!.fullName}
          documents={student!.documents || []}
          applicationForm={student!.applicationForm}
          onChange={reload}
          editable={canEdit}
        />

        {/* Раздел 5 ТЗ (волна 6) — договор рядом с блоком платежей: график
            платежей (PaymentsSection) привязывается именно к нему. */}
        <ContractCard
          studentId={student!.id}
          applications={(student!.applications || []).map((a) => ({ id: a.id, fullName: a.fullName, status: a.status }))}
          canEdit={canEdit}
        />

        <div style={{ marginTop: 28 }}>
          <ApplicationFormSection
            studentId={student!.id}
            initialForm={student!.applicationForm}
            canEdit={canEdit}
            onSaved={reload}
          />
        </div>
        </>
        )}
      </div>

      <AnimatePresence>
        {credentials && (
          <motion.div
            className="dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCredentials(null)}
          >
            <motion.div
              className="dialog-card"
              style={{ maxWidth: 480 }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dialog-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                <Icon name="key" size={28} />
              </div>
              <div className="dialog-title">Новый пароль</div>
              <div className="dialog-message">
                Передайте студенту — пароль показывается один раз.
              </div>
              <div className="creds-box">
                <CredRow label="Логин" value={credentials.email} />
                <CredRow label="Пароль" value={credentials.password} />
              </div>
              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={copyCreds}>
                  <Icon name="content_copy" size={16} style={{ marginRight: 4 }} />
                  Копировать
                </button>
                <button className="btn btn-primary" onClick={() => setCredentials(null)}>Готово</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
