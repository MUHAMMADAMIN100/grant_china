import { useEffect, useState } from 'react';
import { createUser, deleteUser, listUsers, updateUser } from '../api/users';
import type { Role, User } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';

export default function Users() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [items, setItems] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', role: 'EMPLOYEE' as Role });
  const [error, setError] = useState<string | null>(null);

  const load = () => listUsers().then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createUser(form);
      setCreating(false);
      setForm({ email: '', fullName: '', password: '', role: 'EMPLOYEE' });
      load();
    } catch (e: any) {
      setError(e.response?.data?.message?.toString() || 'Ошибка создания');
    }
  };

  const onChangeRole = async (u: User, role: Role) => {
    await updateUser(u.id, { role });
    load();
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
    await deleteUser(u.id);
    toast('Пользователь удалён', 'success');
    load();
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Пользователи системы</h2>
        {!creating && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Добавить</button>}
      </div>
      <div className="card-body">
        {creating && (
          <form onSubmit={onCreate} style={{ marginBottom: 22, padding: 18, background: '#f5f7fb', borderRadius: 10 }}>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid-2">
              <div className="form-group"><label>ФИО</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
              <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="form-group"><label>Пароль</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>
              <div className="form-group">
                <label>Роль</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="EMPLOYEE">Сотрудник</option>
                  <option value="ADMIN">Администратор</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary">Создать</button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>ФИО</th><th>Email</th><th>Роль</th><th>Создан</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><strong>{u.fullName}</strong>{u.id === me?.id && <span style={{ color: '#5b6478', fontSize: 12 }}> (вы)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={(e) => onChangeRole(u, e.target.value as Role)} disabled={u.id === me?.id}>
                      <option value="EMPLOYEE">Сотрудник</option>
                      <option value="ADMIN">Администратор</option>
                    </select>
                  </td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(u)} disabled={u.id === me?.id}>
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
