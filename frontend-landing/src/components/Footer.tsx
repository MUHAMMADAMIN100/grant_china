import { motion } from 'framer-motion';
import Icon from '../Icon';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <motion.div
          className="footer-grid"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <div className="footer-col">
            <div className="footer-brand">GrantChina</div>
            <p className="footer-desc">
              Образовательное агентство с 2015 года. Помогаем поступать в топ-университеты
              Китая на бакалавриат, магистратуру и языковые курсы — без посредников и скрытых комиссий.
            </p>
            <div className="footer-socials">
              <a href="https://t.me/grant_china_tj" target="_blank" rel="noreferrer" aria-label="Telegram" className="footer-social">
                <Icon name="send" size={20} />
              </a>
              <a href="https://wa.me/992777121567" target="_blank" rel="noreferrer" aria-label="WhatsApp" className="footer-social">
                <Icon name="chat" size={20} />
              </a>
              <a href="https://instagram.com/grantchina" target="_blank" rel="noreferrer" aria-label="Instagram" className="footer-social">
                <Icon name="photo_camera" size={20} />
              </a>
              <a href="mailto:info@grantchina.tj" aria-label="Email" className="footer-social">
                <Icon name="mail" size={20} />
              </a>
            </div>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Навигация</div>
            <ul className="footer-links">
              <li><a href="#services">Программы обучения</a></li>
              <li><a href="#directions">Направления</a></li>
              <li><a href="#advantages">Преимущества</a></li>
              <li><a href="#testimonials">Отзывы</a></li>
              <li><a href="#contacts">Контакты</a></li>
              <li><a href="#apply">Оставить заявку</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Программы</div>
            <ul className="footer-links">
              <li><a href="#services">Бакалавриат</a></li>
              <li><a href="#services">Магистратура</a></li>
              <li><a href="#services">Языковые курсы</a></li>
              <li><a href="#services">Стипендия CSC</a></li>
              <li><a href="#services">Подготовка HSK</a></li>
              <li><a href="#services">Виза и сопровождение</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Контакты</div>
            <ul className="footer-contacts">
              <li>
                <Icon name="call" size={16} />
                <a href="tel:+992777121567">+992 777 121 567</a>
              </li>
              <li>
                <Icon name="mail" size={16} />
                <a href="mailto:info@grantchina.tj">info@grantchina.tj</a>
              </li>
              <li>
                <Icon name="location_on" size={16} />
                <span>г. Душанбе, ул. Рудаки, 55</span>
              </li>
              <li>
                <Icon name="schedule" size={16} />
                <span>Пн–Сб: 12:00–18:00<br />Вс — выходной</span>
              </li>
            </ul>
          </div>
        </motion.div>

        <div className="footer-bottom">
          <div>© {new Date().getFullYear()} GrantChina. Все права защищены.</div>
          <div className="footer-tags">
            Образовательное агентство · Обучение в Китае · Без посредников
          </div>
        </div>
      </div>
    </footer>
  );
}
