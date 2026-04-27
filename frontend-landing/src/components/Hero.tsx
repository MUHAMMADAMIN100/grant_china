import { motion } from 'framer-motion';
import { fadeUp, staggerContainer, scaleIn } from '../motion';
import Icon from '../Icon';

export default function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <motion.div
          className="hero-grid"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <div>
            <motion.span className="hero-eyebrow" variants={fadeUp}>
              <Icon name="school" size={18} style={{ marginRight: 6 }} />
              Образование в Китае с 2015 года
            </motion.span>
            <motion.h1 variants={fadeUp}>
              Обучение в <span className="accent">лучших вузах Китая</span> — без посредников
            </motion.h1>
            <motion.p variants={fadeUp}>
              Помогаем студентам поступить на бакалавриат, в магистратуру и
              на языковые курсы в топ-университеты Китая. Полное сопровождение:
              от выбора программы до зачисления.
            </motion.p>
            <motion.div className="hero-cta" variants={fadeUp}>
              <motion.a
                href="#apply"
                className="btn btn-primary btn-large"
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
              >
                Получить консультацию
              </motion.a>
              <motion.a
                href="#services"
                className="btn btn-outline btn-large"
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
              >
                Программы обучения
              </motion.a>
            </motion.div>
          </div>
          <motion.div
            className="hero-image"
            variants={scaleIn}
            animate={{
              y: [0, -12, 0],
              transition: { y: { duration: 4, repeat: Infinity, ease: 'easeInOut' } },
            }}
          >
            <img src="/logo.png" alt="Grant China" className="hero-logo" />
          </motion.div>
        </motion.div>

        <motion.div
          className="stats"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
        >
          {[
            { num: '823', label: 'студентов отправили' },
            { num: '100+', label: 'вузов-партнёров' },
            { num: '6', label: 'лет на рынке' },
            { num: '100%', label: 'успешных зачислений' },
          ].map((s) => (
            <motion.div key={s.label} variants={fadeUp}>
              <div className="stat-num">{s.num}</div>
              <div className="stat-label">{s.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
