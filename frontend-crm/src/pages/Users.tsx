import { useEffect, useState } from 'react';
import { createUser, deleteUser, listUsers, updateUser } from '../api/users';
import type { Region, Role, User } from '../api/types';
import { REGION_BADGE, REGION_DESCRIPTION, REGION_LABEL, ROLE_BADGE, ROLE_DESCRIPTION, ROLE_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { compose, email as emailRule, hasErrors, maxLen, minLen, passwordRule, required, validateAll } from '../utils/validators';
import ChangePasswordModal from '../components/ChangePasswordModal';

// Порядок ролей для выпадающих списков и легенды — от младшей к старшей,
// одно место, откуда берутся и value, и подпись (ROLE_LABEL), чтобы нигде
// в разметке не оставалось хардкода вроде "Сотрудник"/"EMPLOYEE".
const ROLE_OPTIONS: Role[] = ['EMPLOYEE', 'ADMIN', 'FOUNDER'];

// BOTH стоит первым, потому что это значение по умолчанию на бэкенде: так
// работала система до разделения по регионам, и именно его получит сотрудник,
// если про поле забыли. Порядок списка не должен подталкивать сузить доступ
// случайным выбором первой строки.
const REGION_OPTIONS: Region[] = ['BOTH', 'TJ', 'CN'];

/** Регион не приходил со старого бэкенда — пустое значение читаем как BOTH (ТЗ v3 р4). */
const regionOf = (u: User): Region => u.region ?? 'BOTH';

/**
 * ТЗ v3 р4: регион сужает выборку студентов ТОЛЬКО для роли «Менеджер».
 * Основатель и Администратор по ТЗ видят всех студентов обоих направлений,
 * поэтому для них селект — не настройка доступа, а просто сохранённое значение.
 *
 * Поле мы им всё равно показываем (а не прячем): роль меняется прямо в этой же
 * таблице, и если регион исчезает при роли «Администратор», то после понижения
 * до менеджера человек молча получает BOTH — доступ шире, чем задумывали.
 * Вместо этого честно подписываем селект, что сейчас значение ни на что не
 * влияет: скрытое поле объяснить нельзя, подпись — можно.
 */
function regionHint(role: Role, region: Region): string {
  return role === 'EMPLOYEE'
    ? REGION_DESCRIPTION[region]
    : `Роль «${ROLE_LABEL[role]}» видит студентов обоих регионов — значение сохранится, но на доступ сейчас не влияет.`;
}

/**
 * Управление сотрудниками.
 *  - FOUNDER (Основатель) — может всё: создавать/удалять/редактировать
 *    сотрудников, менять им пароли, назначать роли (включая FOUNDER).
 *  - ADMIN (Администратор) — видит список read-only, без кнопок.
 *  - EMPLOYEE (Менеджер) — на эту страницу не попадёт (роутинг блокирует).
 */
export default function Users() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [items, setItems] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', role: 'EMPLOYEE' as Role, region: 'BOTH' as Region });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pwdTarget, setPwdTarget] = useState<User | null>(null);

  const isFounder = me?.role === 'FOUNDER';
  const canEdit = isFounder; // только Основатель может всё менять

  const formErrors = validateAll(
    form,
    {
      email: compose(required('Введите email'), emailRule()),
      fullName: compose(required('Введите ФИО'), minLen(2), maxLen(100)),
      password: compose(required('Введите пароль'), passwordRule()),
    },
  );
  const showErr = (k: keyof typeof formErrors) => touched[k] && formErrors[k];
  const formInvalid = hasErrors(formErrors);

  const load = () => listUsers(search || undefined).then(setItems).catch(() => {});
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, fullName: true, password: true });
    if (formInvalid) return;
    setError(null);
    try {
      await createUser(form);
      setCreating(false);
      setForm({ email: '', fullName: '', password: '', role: 'EMPLOYEE', region: 'BOTH' });
      setTouched({});
      load();
    } catch (e: any) {
      setError(e.response?.data?.message?.toString() || 'Ошибка создания');
    }
  };

  const onChangeRole = async (u: User, role: Role) => {
    try {
      await updateUser(u.id, { role });
      load();
    } catch (e: any) {
      toast(e.response?.data?.message?.toString() || 'Не удалось изменить роль', 'error');
    }
  };

  // Регион правим отдельным PATCH, как и роль: перезагрузка списка после ответа
  // нужна, чтобы в таблице осталось то, что реально сохранил бэкенд, а не то,
  // что успел выбрать пользователь.
  const onChangeRegion = async (u: User, region: Region) => {
    try {
      await updateUser(u.id, { region });
      load();
    } catch (e: any) {
      toast(e.response?.data?.message?.toString() || 'Не удалось изменить регион', 'error');
    }
  };

  const onDelete = async (u: User) => {
    if (u.id === me?.id) {
      toast('Нельзя удалить самого себя', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Удалить пользователя',
      message: `Пользователь «${u.fullName}» будет удалён. Действие нельзя отменить.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteUser(u.id);
      toast('Пользователь удалён', 'success');
      load();
    } catch (e: any) {
      toast(e.response?.data?.message?.toString() || 'Не удалось удалить', 'error');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Пользователи системы</h2>
        {canEdit && !creating && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Добавить</button>}
      </div>
      <div className="card-body">
        <div className="role-legend">
          {ROLE_OPTIONS.map((r) => (
            <div className="role-legend-item" key={r}>
              <span className={`badge ${ROLE_BADGE[r]}`}>{ROLE_LABEL[r]}</span>
              <span className="role-legend-desc">{ROLE_DESCRIPTION[r]}</span>
            </div>
          ))}
        </div>

        <div className="filters">
          <input
            placeholder="Поиск по email или ФИО..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canEdit && creating && (
          <form onSubmit={onCreate} style={{ marginBottom: 22, padding: 18, background: '#f5f7fb', borderRadius: 10 }}>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid-2">
              <div className="form-group">
                <label>ФИО *</label>
                <input
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
                  className={showErr('fullName') ? 'input-error' : ''}
                  maxLength={100}
                  required
                />
                {showErr('fullName') && <div className="form-error-text">{formErrors.fullName}</div>}
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  className={showErr('email') ? 'input-error' : ''}
                  required
                />
                {showErr('email') && <div className="form-error-text">{formErrors.email}</div>}
              </div>
              <div className="form-group">
                <label>Пароль * <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>— мин. 8 симв., буквы и цифры</span></label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  className={showErr('password') ? 'input-error' : ''}
                  minLength={8}
                  required
                />
                {showErr('password') && <div className="form-error-text">{formErrors.password}</div>}
              </div>
              <div className="form-group">
                <label>Роль</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Регион</label>
                <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value as Region })}>
                  {REGION_OPTIONS.map((r) => (
                    <option key={r} value={r}>{REGION_LABEL[r]}</option>
                  ))}
                </select>
                {/*
                  Подпись пересчитывается от выбранной роли: пока выбран «Менеджер»
                  — объясняем, каких студентов он увидит; для остальных ролей сразу
                  предупреждаем, что регион на доступ не влияет. Это дешевле, чем
                  прятать поле и оставлять человека гадать, куда оно делось.
                */}
                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6, lineHeight: 1.5 }}>
                  {regionHint(form.role, form.region)}
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Отмена</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={formInvalid}
                title={formInvalid ? 'Исправьте ошибки в форме' : ''}
              >Создать</button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Регион</th>
                <th>Создан</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><strong>{u.fullName}</strong>{u.id === me?.id && <span style={{ color: '#5b6478', fontSize: 12 }}> (вы)</span>}</td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Роль">
                    {canEdit ? (
                      <select
                        value={u.role}
                        onChange={(e) => onChangeRole(u, e.target.value as Role)}
                        disabled={u.id === me?.id}
                        title={u.id === me?.id ? 'Нельзя изменить собственную роль' : undefined}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role] || u.role}</span>
                    )}
                  </td>
                  {/*
                    Регион показываем всем ролям, но у Основателя и Администратора
                    приглушаем: по ТЗ v3 р4 они видят студентов обоих направлений,
                    и бейдж «Таджикистан» в их строке иначе читается как ограничение,
                    которого на самом деле нет. Расшифровка — в title.
                  */}
                  <td data-label="Регион" title={regionHint(u.role, regionOf(u))}>
                    {canEdit ? (
                      <select
                        value={regionOf(u)}
                        onChange={(e) => onChangeRegion(u, e.target.value as Region)}
                        style={u.role === 'EMPLOYEE' ? undefined : { opacity: 0.55 }}
                      >
                        {REGION_OPTIONS.map((r) => (
                          <option key={r} value={r}>{REGION_LABEL[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`badge ${REGION_BADGE[regionOf(u)]}`}
                        style={u.role === 'EMPLOYEE' ? undefined : { opacity: 0.55 }}
                      >
                        {REGION_LABEL[regionOf(u)]}
                      </span>
                    )}
                  </td>
                  <td data-label="Создан">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—'}</td>
                  {canEdit && (
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setPwdTarget(u)}
                          title="Сменить пароль"
                        >
                          Пароль
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => onDelete(u)}
                          disabled={u.id === me?.id}
                          title={u.id === me?.id ? 'Нельзя удалить самого себя' : undefined}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ChangePasswordModal
        open={!!pwdTarget}
        mode={
          pwdTarget
            ? { kind: 'admin', userId: pwdTarget.id, userName: pwdTarget.fullName }
            : { kind: 'self' }
        }
        onClose={() => setPwdTarget(null)}
      />
    </div>
  );
}
