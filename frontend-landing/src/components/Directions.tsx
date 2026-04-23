import { motion } from 'framer-motion';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';
import Icon from '../Icon';

const directions = [
  {
    icon: 'auto_stories',
    title: 'Гуманитарные науки',
    text: 'Филология, история, культурология, философия, международные отношения',
  },
  {
    icon: 'trending_up',
    title: 'Экономика и бизнес',
    text: 'Менеджмент, финансы, маркетинг, международная торговля',
  },
  {
    icon: 'code',
    title: 'Информационные технологии',
    text: 'Программирование, AI, Data Science, кибербезопасность',
  },
  {
    icon: 'engineering',
    title: 'Инженерия и технические науки',
    text: 'Электроника, машиностроение, автоматизация, робототехника',
  },
  {
    icon: 'medical_services',
    title: 'Медицина и биология',
    text: 'MBBS, фармакология, биотехнология, генетика, стоматология',
  },
  {
    icon: 'gavel',
    title: 'Юриспруденция',
    text: 'Международное и коммерческое право, правоведение',
  },
  {
    icon: 'palette',
    title: 'Творческие направления',
    text: 'Дизайн, изобразительное искусство, архитектура, анимация, музыка',
  },
  {
    icon: 'sports_soccer',
    title: 'Физическая культура и спорт',
    text: 'Спортивный менеджмент, тренерство, физвоспитание',
  },
  {
    icon: 'flight_takeoff',
    title: 'Туризм и сервис',
    text: 'Гостиничный бизнес, индустрия гостеприимства, международный туризм',
  },
  {
    icon: 'cast_for_education',
    title: 'Педагогика',
    text: 'Преподавание китайского, психология, методика обучения',
  },
];

export default function Directions() {
  return (
    <section id="directions" className="section section-soft">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>Направления</motion.div>
          <motion.h2 variants={fadeUp}>Чему можно учиться в Китае</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Более 10 направлений подготовки в лучших университетах КНР — от гуманитарных наук до IT и медицины
          </motion.p>
        </motion.div>

        <motion.div
          className="directions-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {directions.map((d) => (
            <motion.div
              key={d.title}
              className="direction-card"
              variants={fadeUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
            >
              <motion.div
                className="direction-icon"
                whileHover={{ scale: 1.12, rotate: 5 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Icon name={d.icon} size={28} />
              </motion.div>
              <h3>{d.title}</h3>
              <p>{d.text}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
