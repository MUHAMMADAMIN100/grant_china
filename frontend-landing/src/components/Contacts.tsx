import { motion } from 'framer-motion';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';
import Icon from '../Icon';

const contacts = [
  { icon: 'call', title: 'Телефон', content: <a href="tel:+992900000000">+992 900 00 00 00</a> },
  { icon: 'mail', title: 'Email', content: <a href="mailto:info@grantchina.tj">info@grantchina.tj</a> },
  { icon: 'location_on', title: 'Адрес', content: <span>г. Душанбе, ул. Рудаки, 137</span> },
];

export default function Contacts() {
  return (
    <section id="contacts" className="section section-soft">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>Контакты</motion.div>
          <motion.h2 variants={fadeUp}>Свяжитесь с нами</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Ответим на любые вопросы о поступлении в Китай
          </motion.p>
        </motion.div>

        <motion.div
          className="contacts-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          {contacts.map((c) => (
            <motion.div
              key={c.title}
              className="contact-item"
              variants={fadeUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
            >
              <motion.div
                className="contact-icon"
                whileHover={{ scale: 1.2, rotate: 10 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Icon name={c.icon} size={40} />
              </motion.div>
              <h3>{c.title}</h3>
              {c.content}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
