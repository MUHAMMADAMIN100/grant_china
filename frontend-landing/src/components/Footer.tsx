import { motion } from 'framer-motion';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <motion.img
          src="/logo.png"
          alt="Grant China"
          className="footer-logo"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        />
        <p>© {new Date().getFullYear()} GrantChina. Все права защищены.</p>
        <p>Образовательное агентство · Обучение в Китае</p>
      </div>
    </footer>
  );
}
