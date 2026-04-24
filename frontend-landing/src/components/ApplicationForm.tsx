import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { submitApplication, type Direction } from '../api';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';
import { getPublicProgram, type Program } from '../programs';
import Icon from '../Icon';

const MAX_NAME = 100;
const MAX_EMAIL = 120;
const MAX_COMMENT = 500;
const MAX_PHONE_DIGITS = 15;

const formatPhone = (raw: string) => {
  const cleaned = raw.replace(/[^\d+]/g, '');
  const hasPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '').slice(0, MAX_PHONE_DIGITS);
  if (!digits) return hasPlus ? '+' : '';
  const parts: string[] = [];
  parts.push(digits.slice(0, 3));
  if (digits.length > 3) parts.push(digits.slice(3, 6));
  if (digits.length > 6) parts.push(digits.slice(6, 8));
  if (digits.length > 8) parts.push(digits.slice(8, 10));
  if (digits.length > 10) parts.push(digits.slice(10));
  return (hasPlus ? '+' : '') + parts.filter(Boolean).join(' ');
};

const countPhoneDigits = (phone: string) => phone.replace(/\D/g, '').length;

type Errors = Partial<Record<'fullName' | 'phone' | 'email' | 'comment', string>>;

export default function ApplicationForm() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [direction, setDirection] = useState<Direction>('BACHELOR');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [preselectedProgram, setPreselectedProgram] = useState<Program | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('program');
    if (pid) {
      getPublicProgram(pid)
        .then((p) => {
          setPreselectedProgram(p);
          setDirection(p.direction);
        })
        .catch(() => {});
    }
  }, []);

  const validateField = (field: keyof Errors, value: string): string | undefined => {
    if (field === 'fullName') {
      const v = value.trim();
      if (v.length === 0) return 'Введите ваше ФИО';
      if (v.length < 2) return 'Имя слишком короткое';
      if (v.length > MAX_NAME) return `Максимум ${MAX_NAME} символов`;
      if (!/[A-Za-zА-Яа-яЁёҚқҒғҲҳҶҷӢӣӮӯ]/.test(v)) return 'ФИО должно содержать буквы';
      if (/[<>{}[\]\\\/]/.test(v)) return 'Недопустимые символы';
      return;
    }
    if (field === 'phone') {
      const v = value.trim();
      if (v.length === 0) return 'Укажите номер телефона';
      const digits = countPhoneDigits(v);
      if (digits < 9) return 'Телефон слишком короткий';
      if (digits > MAX_PHONE_DIGITS) return 'Телефон слишком длинный';
      if (!/^[+\d\s\-()]+$/.test(v)) return 'Недопустимые символы';
      return;
    }
    if (field === 'email') {
      const v = value.trim();
      if (!v) return; // необязательное
      if (v.length > MAX_EMAIL) return `Максимум ${MAX_EMAIL} символов`;
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) return 'Некорректный email';
      return;
    }
    if (field === 'comment') {
      if (value.length > MAX_COMMENT) return `Максимум ${MAX_COMMENT} символов`;
      return;
    }
    return;
  };

  const checkAll = (): Errors => ({
    fullName: validateField('fullName', fullName),
    phone: validateField('phone', phone),
    email: validateField('email', email),
    comment: validateField('comment', comment),
  });

  const cleanErrors = (e: Errors): Errors => {
    const out: Errors = {};
    (Object.keys(e) as (keyof Errors)[]).forEach((k) => {
      if (e[k]) out[k] = e[k];
    });
    return out;
  };

  const handleBlur = (field: keyof Errors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const value = field === 'fullName' ? fullName : field === 'phone' ? phone : field === 'email' ? email : comment;
    const err = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: err }));
  };

  const handleFieldChange = (field: keyof Errors, value: string) => {
    if (field === 'fullName') setFullName(value);
    else if (field === 'phone') setPhone(formatPhone(value));
    else if (field === 'email') setEmail(value);
    else if (field === 'comment') setComment(value);
    // Если поле уже тронуто или есть ошибка — переоцениваем на лету
    if (touched[field] || errors[field]) {
      const err = validateField(field, field === 'phone' ? formatPhone(value) : value);
      setErrors((prev) => ({ ...prev, [field]: err }));
    }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const all = cleanErrors(checkAll());
    setErrors(all);
    setTouched({ fullName: true, phone: true, email: true, comment: true });
    if (Object.keys(all).length > 0) return;

    setSubmitting(true);
    try {
      await submitApplication({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        direction,
        comment: comment.trim() || undefined,
        programId: preselectedProgram?.id,
      });
      setSuccess(true);
      // Аналитика: событие конверсии
      try {
        (window as any).gtag?.('event', 'submit_application', { direction });
        (window as any).ym?.((window as any).__YM_ID__, 'reachGoal', 'APPLICATION_SUBMIT');
      } catch {}
      setFullName(''); setPhone(''); setEmail(''); setComment('');
      setDirection('BACHELOR');
      setErrors({});
      setTouched({});
      setTimeout(() => setSuccess(false), 6000);
    } catch (err: any) {
      setServerError(err?.message || 'Ошибка отправки. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  const invalid = (f: keyof Errors) => (touched[f] || !!errors[f]) && !!errors[f];

  return (
    <section id="apply" className="form-section">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>Заявка</motion.div>
          <motion.h2 variants={fadeUp}>Получите бесплатную консультацию</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Оставьте заявку — менеджер свяжется в течение часа и подберёт программу под вас
          </motion.p>
        </motion.div>

        <motion.form
          className="form-card"
          onSubmit={handleSubmit}
          noValidate
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {preselectedProgram && (
            <motion.div
              className="form-program-badge"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Icon name="school" size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>{preselectedProgram.name}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {preselectedProgram.university} · {preselectedProgram.city}
                </div>
              </div>
              <button
                type="button"
                className="form-program-clear"
                onClick={() => setPreselectedProgram(null)}
                title="Убрать программу"
              >
                <Icon name="close" size={16} />
              </button>
            </motion.div>
          )}

          <AnimatePresence>
            {success && (
              <motion.div
                className="form-success"
                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
              >
                <Icon name="check_circle" size={20} style={{ marginRight: 8, color: 'var(--success)' }} />
                Заявка отправлена! Мы свяжемся с вами в ближайшее время.
              </motion.div>
            )}
            {serverError && (
              <motion.div
                className="form-fail"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: [0, -8, 8, -6, 6, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                <Icon name="warning" size={20} style={{ marginRight: 8 }} />
                {serverError}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="form-row">
            <label>ФИО *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => handleFieldChange('fullName', e.target.value)}
              onBlur={() => handleBlur('fullName')}
              placeholder="Иванов Иван Иванович"
              maxLength={MAX_NAME}
              className={invalid('fullName') ? 'input-error' : ''}
              autoComplete="name"
            />
            <AnimatePresence>
              {invalid('fullName') && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {errors.fullName}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="form-row">
            <label>Номер телефона *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => handleFieldChange('phone', e.target.value)}
              onBlur={() => handleBlur('phone')}
              placeholder="+992 900 00 00 00"
              className={invalid('phone') ? 'input-error' : ''}
              autoComplete="tel"
              inputMode="tel"
            />
            <AnimatePresence>
              {invalid('phone') && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {errors.phone}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="form-row">
            <label>Email (необязательно)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => handleFieldChange('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              placeholder="you@example.com"
              maxLength={MAX_EMAIL}
              className={invalid('email') ? 'input-error' : ''}
              autoComplete="email"
            />
            <AnimatePresence>
              {invalid('email') && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {errors.email}
                </motion.div>
              )}
            </AnimatePresence>
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
            <label>
              Комментарий
              <span className="form-counter">{comment.length} / {MAX_COMMENT}</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => handleFieldChange('comment', e.target.value)}
              onBlur={() => handleBlur('comment')}
              placeholder="Расскажите о ваших целях, желаемом городе или вузе..."
              maxLength={MAX_COMMENT}
              className={invalid('comment') ? 'input-error' : ''}
            />
            <AnimatePresence>
              {invalid('comment') && (
                <motion.div
                  className="form-error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {errors.comment}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={submitting}
            whileHover={!submitting ? { scale: 1.02, y: -2 } : {}}
            whileTap={!submitting ? { scale: 0.98 } : {}}
          >
            {submitting ? 'Отправляем...' : 'Отправить заявку'}
          </motion.button>
        </motion.form>
      </div>
    </section>
  );
}
