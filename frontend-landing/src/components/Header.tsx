export default function Header() {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="#" className="logo">
          <span className="logo-mark">G</span>
          <span>GrantChina</span>
        </a>
        <nav className="nav">
          <a href="#services">Программы</a>
          <a href="#advantages">Преимущества</a>
          <a href="#contacts">Контакты</a>
        </nav>
        <a href="#apply" className="btn btn-primary">Оставить заявку</a>
      </div>
    </header>
  );
}
