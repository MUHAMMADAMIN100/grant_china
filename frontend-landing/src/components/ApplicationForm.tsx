import { useState } from 'react';
import { submitApplication, type Direction } from '../api';

export default function ApplicationForm() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [direction, setDirection] = useState<Direction>('BACHELOR');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (fullName.trim().length < 2) e.fullName = 'Введите ваше ФИО';
    if (phone.trim().length < 5) e.phone = 'Укажите телефон';
    if (email && !/^\S+@\S+\.\S+$/.test(email)) e.email = 'Некорректный email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await submitApplication({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        direction,
        comment: comment.trim() || undefined,
      });
      setSuccess(true);
      setFullName(''); setPhone(''); setEmail(''); setComment('');
      setDirection('BACHELOR');
    } catch (err: any) {
      setServerError(err?.message || 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="apply" className="form-section">
      <div className="container">
        <div className="section-eyebrow">Заявка</div>
        <h2>Получите бесплатную консультацию</h2>
        <p className="section-sub">
          Оставьте заявку — менеджер свяжется в течение часа и подберёт программу под вас
        </p>

        <form className="form-card" onSubmit={handleSubmit} noValidate>
          {success && (
            <div className="form-success">
              ✓ Заявка отправлена! Мы свяжемся с вами в ближайшее время.
            </div>
          )}
          {serverError && <div className="form-fail">⚠ {serverError}</div>}

          <div className="form-row">
            <label>ФИО *</label>
            <input
              type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
            />
            {errors.fullName && <div className="form-error">{errors.fullName}</div>}
          </div>

          <div className="form-row">
            <label>Номер телефона *</label>
            <input
              type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+992 900 00 00 00"
            />
            {errors.phone && <div className="form-error">{errors.phone}</div>}
          </div>

          <div className="form-row">
            <label>Email (необязательно)</label>
            <input
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            {errors.email && <div className="form-error">{errors.email}</div>}
          </div>

          <div className="form-row">
            <label>Направление *</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              <option value="BACHELOR">Бакалавриат</option>
              <option value="MASTER">Магистратура</option>
              <option value="LANGUAGE">Языковые курсы</option>
            </select>
          </div>

          <div className="form-row">
            <label>Комментарий</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Расскажите о ваших целях, желаемом городе или вузе..."
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={submitting}
          >
            {submitting ? 'Отправляем...' : 'Отправить заявку'}
          </button>
        </form>
      </div>
    </section>
  );
}
