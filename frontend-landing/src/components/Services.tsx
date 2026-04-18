export default function Services() {
  return (
    <section id="services" className="section">
      <div className="container">
        <div className="section-eyebrow">Программы обучения</div>
        <h2>Три направления, тысячи возможностей</h2>
        <p className="section-sub">
          Выбирайте программу — и мы поможем поступить в выбранный вуз Китая под ключ
        </p>
        <div className="services-grid">
          <div className="service-card">
            <div className="service-icon bachelor">🎓</div>
            <h3>Бакалавриат</h3>
            <p>Высшее образование в престижных вузах Китая на английском или китайском языке.</p>
            <ul>
              <li>Подбор университета и программы</li>
              <li>Подача документов и виза</li>
              <li>Помощь со стипендией CSC</li>
              <li>Сопровождение по приезду</li>
            </ul>
          </div>
          <div className="service-card">
            <div className="service-icon master">🎯</div>
            <h3>Магистратура</h3>
            <p>Получите магистерскую степень в одном из топ-200 университетов мира.</p>
            <ul>
              <li>Анализ вашего профиля</li>
              <li>Подготовка motivation letter</li>
              <li>Гранты и стипендии</li>
              <li>Подготовка к интервью</li>
            </ul>
          </div>
          <div className="service-card">
            <div className="service-icon language">💬</div>
            <h3>Языковые курсы</h3>
            <p>Интенсивное изучение китайского языка с погружением в культуру.</p>
            <ul>
              <li>Курсы от 6 месяцев до 2 лет</li>
              <li>Подготовка к HSK</li>
              <li>Студенческая виза X</li>
              <li>Проживание в кампусе</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
