import { motion } from 'framer-motion';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';
import Icon from '../Icon';

const services = [
  {
    iconClass: 'bachelor',
    icon: 'school',
    title: 'Бакалавриат',
    text: 'Высшее образование в престижных вузах Китая на английском или китайском языке.',
    items: [
      'Подбор университета и программы',
      'Подача документов и виза',
      'Помощь со стипендией CSC',
      'Сопровождение по приезду',
    ],
  },
  {
    iconClass: 'master',
    icon: 'workspace_premium',
    title: 'Магистратура',
    text: 'Получите магистерскую степень в одном из топ-200 университетов мира.',
    items: [
      'Анализ вашего профиля',
      'Подготовка motivation letter',
      'Гранты и стипендии',
      'Подготовка к интервью',
    ],
  },
  {
    iconClass: 'language',
    icon: 'translate',
    title: 'Языковые курсы',
    text: 'Интенсивное изучение китайского языка с погружением в культуру.',
    items: [
      'Курсы от 6 месяцев до 2 лет',
      'Подготовка к HSK',
      'Студенческая виза X',
      'Проживание в кампусе',
    ],
  },
];

export default function Services() {
  return (
    <section id="services" className="section">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>
            Программы обучения
          </motion.div>
          <motion.h2 variants={fadeUp}>Три направления, тысячи возможностей</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Выбирайте программу — и мы поможем поступить в выбранный вуз Китая под ключ
          </motion.p>
        </motion.div>

        <motion.div
          className="services-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {services.map((s) => (
            <motion.div
              key={s.title}
              className="service-card"
              variants={fadeUp}
              whileHover={{ y: -8, transition: { duration: 0.25 } }}
            >
              <motion.div
                className={`service-icon ${s.iconClass}`}
                whileHover={{ rotate: [0, -8, 8, 0], transition: { duration: 0.5 } }}
              >
                <Icon name={s.icon} size={32} />
              </motion.div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
