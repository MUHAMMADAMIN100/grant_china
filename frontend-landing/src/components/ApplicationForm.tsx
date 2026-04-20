import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { submitApplication, type Direction } from '../api';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';

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
          <AnimatePresence>
            {success && (
              <motion.div
                className="form-success"
                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
              >
                ✓ Заявка отправлена! Мы свяжемся с вами в ближайшее время.
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
                ⚠ {serverError}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="form-row">
            <label>ФИО *</label>
            <input
              type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
            />
            <AnimatePresence>
              {errors.fullName && (
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
              type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+992 900 00 00 00"
            />
            <AnimatePresence>
              {errors.phone && (
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
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <AnimatePresence>
              {errors.email && (
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
            <label>Комментарий</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Расскажите о ваших целях, желаемом городе или вузе..."
            />
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
