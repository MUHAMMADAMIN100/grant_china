export default function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-grid">
          <div>
            <span className="hero-eyebrow">🏯 Образование в Китае с 2015 года</span>
            <h1>
              Обучение в <span className="accent">лучших вузах Китая</span> — без посредников
            </h1>
            <p>
              Помогаем студентам поступить на бакалавриат, в магистратуру и
              на языковые курсы в топ-университеты Китая. Полное сопровождение:
              от выбора программы до зачисления.
            </p>
            <div className="hero-cta">
              <a href="#apply" className="btn btn-primary btn-large">Получить консультацию</a>
              <a href="#services" className="btn btn-outline btn-large">Программы обучения</a>
            </div>
          </div>
          <div className="hero-image">🏯</div>
        </div>

        <div className="stats">
          <div>
            <div className="stat-num">800+</div>
            <div className="stat-label">студентов отправили</div>
          </div>
          <div>
            <div className="stat-num">50+</div>
            <div className="stat-label">вузов-партнёров</div>
          </div>
          <div>
            <div className="stat-num">10</div>
            <div className="stat-label">лет на рынке</div>
          </div>
          <div>
            <div className="stat-num">98%</div>
            <div className="stat-label">успешных зачислений</div>
          </div>
        </div>
      </div>
    </section>
  );
}
