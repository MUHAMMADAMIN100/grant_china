export default function Contacts() {
  return (
    <section id="contacts" className="section section-soft">
      <div className="container">
        <div className="section-eyebrow">Контакты</div>
        <h2>Свяжитесь с нами</h2>
        <p className="section-sub">Ответим на любые вопросы о поступлении в Китай</p>
        <div className="contacts-grid">
          <div className="contact-item">
            <div className="contact-icon">📞</div>
            <h3>Телефон</h3>
            <a href="tel:+992900000000">+992 900 00 00 00</a>
          </div>
          <div className="contact-item">
            <div className="contact-icon">✉️</div>
            <h3>Email</h3>
            <a href="mailto:info@grantchina.tj">info@grantchina.tj</a>
          </div>
          <div className="contact-item">
            <div className="contact-icon">📍</div>
            <h3>Адрес</h3>
            <span>г. Душанбе, ул. Рудаки, 137</span>
          </div>
        </div>
      </div>
    </section>
  );
}
