import { motion } from 'framer-motion';

export default function Header() {
  return (
    <motion.header
      className="header"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="container header-inner">
        <motion.a
          href="#"
          className="logo"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="logo-mark">G</span>
          <span>GrantChina</span>
        </motion.a>
        <nav className="nav">
          <motion.a href="#services" whileHover={{ y: -2 }}>Программы</motion.a>
          <motion.a href="#advantages" whileHover={{ y: -2 }}>Преимущества</motion.a>
          <motion.a href="#contacts" whileHover={{ y: -2 }}>Контакты</motion.a>
        </nav>
        <motion.a
          href="#apply"
          className="btn btn-primary"
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.95 }}
        >
          Оставить заявку
        </motion.a>
      </div>
    </motion.header>
  );
}
