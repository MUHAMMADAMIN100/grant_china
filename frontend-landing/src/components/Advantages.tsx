import { motion } from 'framer-motion';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';

const advantages = [
  { icon: '🤝', title: 'Прямые контракты с вузами', text: 'Работаем напрямую с университетами — никаких посредников и скрытых комиссий.' },
  { icon: '💰', title: 'Помощь со стипендией', text: 'Знаем, как получить полную или частичную стипендию CSC и университетские гранты.' },
  { icon: '📋', title: 'Полное сопровождение', text: 'От подачи документов до встречи в аэропорту — каждый шаг под контролем менеджера.' },
  { icon: '⚡', title: 'Быстрая обработка', text: 'Отвечаем на заявки в течение часа, документы готовим за 3–5 рабочих дней.' },
  { icon: '🏆', title: '98% зачислений', text: 'За 10 лет работы помогли 800+ студентам поступить в выбранный вуз.' },
  { icon: '🛡️', title: 'Гарантия результата', text: 'Если не поступите — вернём оплату по договору. Никаких рисков.' },
];

export default function Advantages() {
  return (
    <section id="advantages" className="section section-soft">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>
            Почему мы
          </motion.div>
          <motion.h2 variants={fadeUp}>Преимущества GrantChina</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Проверенный путь к китайскому образованию
          </motion.p>
        </motion.div>

        <motion.div
          className="advantages-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {advantages.map((a) => (
            <motion.div
              key={a.title}
              className="advantage"
              variants={fadeUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
            >
              <motion.div
                className="advantage-icon"
                whileHover={{ scale: 1.15, rotate: 5 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                {a.icon}
              </motion.div>
              <h3>{a.title}</h3>
              <p>{a.text}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
