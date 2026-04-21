import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fadeUp, staggerContainer, viewportOnce } from '../motion';
import Icon from '../Icon';

type Testimonial = {
  name: string;
  photo: string;
  university: string;
  program: string;
  rating: string;
  text: string;
};

const testimonials: Testimonial[] = [
  {
    name: 'NASRIDDINSHOZODA SURUSH MUNIR',
    photo: '/testimonials/surush.jpg',
    university: "Xi'an Jiaotong University",
    program: 'MBBS (Медицина, обучение на английском языке)',
    rating: 'Топ-30 университетов Китая, входит в топ-300 мира',
    text:
      'Я очень благодарен компании Grant China за помощь в поступлении в Китай. С самого начала мне подробно объяснили весь процесс, помогли собрать документы и всегда были на связи. Благодаря их поддержке всё прошло быстро и без лишнего стресса. Я смог поступить в один из ведущих университетов Китая. Отдельно хочу отметить их ответственность и внимательное отношение к клиентам. Рекомендую Grant China всем, кто планирует учёбу в Китае.',
  },
  {
    name: 'NASRULLOEV MILLAT',
    photo: '/testimonials/millat.jpg',
    university: 'Guangdong University of Business and Technology',
    program: 'Chinese Language and Culture (языковой курс, non-degree)',
    rating: 'Частный университет Китая, практическое образование и международные студенты',
    text:
      'Grant China — это надёжная и профессиональная организация, которая помогает студентам поступить и учиться в Китае. С самого начала я получил подробную консультацию по выбору университета, специальности и города, что значительно упростило процесс принятия решения. Особенно хочу отметить поддержку на каждом этапе: от подачи документов до получения визы. Все объясняется чётко, без лишней воды, и всегда можно задать любой вопрос — команда отвечает быстро и по делу. Если вы планируете учёбу в Китае и хотите пройти этот путь спокойно и уверенно, Grant China — отличный выбор.',
  },
  {
    name: 'YAROV BILOL',
    photo: '/testimonials/bilol.jpg',
    university: 'Yangzhou Polytechnic University',
    program: 'Chinese Language (языковой курс)',
    rating: 'Государственный профессиональный университет Китая, подготовка иностранных студентов',
    text:
      'Я очень рад, что сейчас учусь в Китае, в городе Янчжоу. Город спокойный и комфортный для жизни и учёбы. Учебный процесс идёт нормально, материал постепенно становится понятнее, преподавание на хорошем уровне. Есть возможность общаться с людьми из разных стран и узнавать новую культуру. Отдельно хочу отметить Grant China — помогли с документами, объяснили весь процесс и всегда были на связи. Благодаря этому поступление прошло спокойно и без сложностей. Решение приехать сюда считаю правильным — это хороший опыт и полезный шаг для будущего.',
  },
  {
    name: 'ISROFILOV MUHAMMADJON PARVIZOVICH',
    photo: '/testimonials/muhammadjon.jpg',
    university: 'Guangdong University of Business and Technology',
    program: 'Chinese Language and Culture (языковой курс, non-degree)',
    rating: 'Частный университет Китая, практическое обучение и международные студенты',
    text:
      'Хочу оставить отзыв про Grant China. Сначала вообще не понимал, как поступить в Китай. Обратился сюда — всё объяснили просто и понятно, всегда были на связи. В итоге спокойно поступил без лишних нервов. Всё сделали чётко, как и обещали. Grant China — реально надёжная и одна из лучших компаний для поступления в Китай.',
  },
  {
    name: 'TURAKULOV JAHONGIR',
    photo: '/testimonials/jahongir.jpg',
    university: 'Nanning Vocational and Technical University',
    program: 'Chinese Language (языковой курс, non-degree)',
    rating: 'Государственный профессиональный университет Китая, практическое обучение специалистов',
    text:
      'Очень доволен, что выбрал обучение в Китае через компанию Grant China. Всё сделали быстро и чётко — помогли с документами и подробно объяснили каждый этап поступления. Сейчас учусь в Китае, каждый день получаю новые знания и опыт. Жизнь здесь очень интересная и насыщенная — новые друзья, культура и большие возможности для развития. Спасибо Grant China за поддержку и профессионализм, всё прошло на высшем уровне!',
  },
];

function Avatar({ name, photo }: { name: string; photo: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  if (failed) {
    return <div className="testimonial-avatar testimonial-avatar-fallback">{initials}</div>;
  }
  return (
    <img
      src={photo}
      alt={name}
      className="testimonial-avatar"
      onError={() => setFailed(true)}
    />
  );
}

export default function Testimonials() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % testimonials.length);
    }, 7000);
    return () => clearInterval(t);
  }, [paused]);

  const prev = () => setIndex((i) => (i - 1 + testimonials.length) % testimonials.length);
  const next = () => setIndex((i) => (i + 1) % testimonials.length);

  const t = testimonials[index];

  return (
    <section id="testimonials" className="section">
      <div className="container">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
        >
          <motion.div className="section-eyebrow" variants={fadeUp}>Отзывы</motion.div>
          <motion.h2 variants={fadeUp}>Что говорят наши студенты</motion.h2>
          <motion.p className="section-sub" variants={fadeUp}>
            Реальные истории ребят, которые уже учатся в Китае
          </motion.p>
        </motion.div>

        <motion.div
          className="testimonials-carousel"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <button className="testimonial-arrow testimonial-arrow-left" onClick={prev} aria-label="Назад">
            <Icon name="chevron_left" size={28} />
          </button>

          <div className="testimonial-stage">
            <AnimatePresence mode="wait">
              <motion.div
                key={index}
                className="testimonial-card"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="testimonial-photo-col">
                  <Avatar name={t.name} photo={t.photo} />
                </div>
                <div className="testimonial-body">
                  <Icon name="format_quote" size={40} className="testimonial-quote" />
                  <p className="testimonial-text">{t.text}</p>
                  <div className="testimonial-author">
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-meta">
                      <div><Icon name="school" size={16} /> {t.university}</div>
                      <div><Icon name="menu_book" size={16} /> {t.program}</div>
                      <div><Icon name="emoji_events" size={16} /> {t.rating}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <button className="testimonial-arrow testimonial-arrow-right" onClick={next} aria-label="Вперёд">
            <Icon name="chevron_right" size={28} />
          </button>
        </motion.div>

        <div className="testimonial-dots">
          {testimonials.map((_, i) => (
            <button
              key={i}
              className={`testimonial-dot${i === index ? ' active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Отзыв ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
