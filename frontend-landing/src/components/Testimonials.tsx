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
  {
    name: 'ABDULLAEV BEZHAN',
    photo: '/testimonials/bezhan.jpg',
    university: 'Shanghai Dianji University',
    program: 'Marketing (маркетинг)',
    rating: 'Государственный университет Китая, сильные программы в сфере бизнеса и технологий',
    text:
      'Отзыв от отца, Абдуллаев Абдурахмон: хочу поделиться положительным опытом сотрудничества с Grant China TJ. Благодаря их профессионализму и внимательному подходу мой сын успешно поступил на обучение в один из университетов Шанхая. С самого начала сотрудники сопровождали нас на каждом этапе — от выбора учебного заведения до оформления документов и адаптации на месте. Особенно хочу отметить их ответственность, оперативность и прозрачность. Все вопросы решались быстро и грамотно. Для родителей это крайне важно, когда речь идёт о будущем ребёнка и обучении за рубежом. Рекомендую компанию всем, кто рассматривает обучение в Китае для своих детей — это надёжные и компетентные специалисты, которым можно доверять.',
  },
  {
    name: 'KHOMIDOV MARUFKHON',
    photo: '/testimonials/marufkhon.jpg',
    university: 'Nanjing Vocational University of Industry Technology',
    program: 'Chinese Language (языковой курс)',
    rating: 'Государственный профессиональный университет Китая, технические направления и подготовка иностранных студентов',
    text:
      'Благодаря Grant China TJ я с 2024 года учусь и нахожусь в Китае, что дало огромный вклад моему развитию. Я начал видеть мир с другой стороны и развиваться намного быстрее, находясь вдали от дома. Благодарен Grant China TJ за возможность, которую они воплотили, и поддержку, которая была на всём пути и даже после поступления. Спасибо!',
  },
  {
    name: 'AMANOVA KRISTINA',
    photo: '/testimonials/kristina.jpg',
    university: 'Nanjing Normal University',
    program: 'Chinese Language (языковой курс)',
    rating: 'Топ-50 университетов Китая, один из ведущих педагогических вузов страны',
    text:
      'Я обратилась к Grant China в мае 2025 года, когда уже всерьёз задумалась о поступлении в Китай и не до конца понимала, с чего начать. Мне всё спокойно и понятно объяснили, разложили процесс по шагам и помогли с подготовкой документов. За счёт этого не было ощущения хаоса — наоборот, стало намного легче ориентироваться во всём процессе. Особенно ценно было то, что на каждом этапе чувствовалась поддержка. В итоге я поступила и сейчас уже учусь в Китае. Очень довольна и благодарна, рекомендую Grant China тем, кто тоже планирует поступление в Китай.',
  },
  {
    name: 'YEFREMOV ARTUR',
    photo: '/testimonials/artur.jpg',
    university: 'Shanghai University of Electric Power',
    program: 'International Economy and Trade (международная экономика и торговля)',
    rating: 'Государственный университет Китая, специализируется на энергетике, экономике и инженерных направлениях',
    text:
      'Обращался в Grant China для поступления в Китай. Всё прошло максимально чётко и без лишних сложностей. Ребята работают быстро, всегда на связи, объясняют каждый шаг, поэтому никаких сомнений или неприятных сюрпризов не было. Сам университет тоже приятно удивил: современная атмосфера, сильная программа и очень дружелюбное коммьюнити. Быстро влился в студенческую жизнь, познакомился с отличными людьми. На мой взгляд, здесь реально комфортно учиться и развиваться. В целом остался полностью доволен и агентством, и выбором университета. Могу смело рекомендовать тем, кто думает поступать за границу.',
  },
  {
    name: 'ABDUKHALIKOV YOKUB',
    photo: '/testimonials/yokub.jpg',
    university: 'Guangdong University of Business and Technology',
    program: 'Chinese Language and Culture (языковой курс, non-degree)',
    rating: 'Частный университет Китая, ориентирован на практическое обучение и международных студентов',
    text:
      'Большое спасибо агентству Grant China за помощь! Весь процесс — от подачи заявки до поступления — прошёл очень гладко. Кураторы очень профессиональны, помогли с документами и терпеливо отвечали на вопросы. Сейчас я успешно учусь. Всем рекомендую!',
  },
  {
    name: 'BURLAKOV DALER',
    photo: '/testimonials/daler.jpg',
    university: 'Nanjing University of Industry Technology',
    program: 'Software Engineering (программная инженерия)',
    rating: 'Государственный университет Китая, специализируется на IT и инженерных направлениях',
    text:
      'Раньше у меня была мечта учиться в Китае и однажды побывать в Шанхае. Поступление в Китай казалось для меня чем-то очень сложным и дорогим, пока однажды мне не посоветовали компанию Grant China. По доступной цене они подобрали мне нужную программу обучения, и на протяжении моей учёбы в Китае остаются со мной на связи. Как видите, мечты сбываются — возможно, Grant China поможет и вашей мечте сбыться.',
  },
  {
    name: 'ASKAROVA MADINA',
    photo: '/testimonials/madina.jpg',
    university: 'Xinjiang Medical University',
    program: 'Clinical Medicine (клиническая медицина, на китайском языке)',
    rating: 'Государственный медицинский университет Китая, ведущий вуз региона в сфере медицины',
    text:
      'Хочу выразить огромную благодарность компании Grant China за помощь в поступлении. Благодаря вам я успешно поступила и сейчас обучаюсь на медицинском факультете. С самого начала вы подробно объяснили все этапы, помогли выбрать университет, подготовить документы и оформить приглашение. На каждом этапе вы были на связи, отвечали на все вопросы и поддерживали. После приезда в Китай я быстро адаптировалась: общежитие комфортное, кампус современный, преподаватели объясняют понятно и уделяют внимание студентам. Занятия проходят интересно, особенно на медицинском факультете. Здесь хорошая международная среда, можно познакомиться со студентами из разных стран. Очень благодарна за профессионализм и поддержку — благодаря вам моя мечта учиться в Китае стала реальностью. Рекомендую всем, кто планирует поступать за границу!',
  },
  {
    name: 'TAGOEVA ANUSHA',
    photo: '/testimonials/anusha.jpg',
    university: 'Nanjing University of Information Science and Technology',
    program: 'Computer Science and Technology (информатика и технологии, на английском языке)',
    rating: 'Топ-100 университетов Китая, сильный вуз в сфере IT и инженерии',
    text:
      'Уже второй год учусь в Китае по программе Grant China TJ, и время пролетело незаметно. Спасибо за доверие, поддержку и невероятное приключение. Китай стал второй семьёй, а этот опыт — лучшим в жизни 🇨🇳❤️',
  },
  {
    name: 'Мама студентов из Нанкина',
    photo: '/testimonials/mama.jpg',
    university: 'Двое детей учатся в Нанкине, Китай',
    program: 'Родитель студентов Grant China',
    rating: 'Дочь — 2-й год обучения, сын — 1-й год обучения',
    text:
      'Хочу выразить искреннюю благодарность вашей команде за огромную работу, профессионализм и внимательное отношение к каждой семье. Благодаря вам наши двое старших детей успешно поступили и учатся в международных университетах в Нанкине: дочь уже второй год уверенно осваивает программу, а сын в этом году только начал свой путь — и тоже чувствует себя комфортно и уверенно. Особенно хочется отметить вашу постоянную поддержку на всех этапах — от выбора учебного заведения до адаптации на месте. Вы всегда на связи, готовы помочь и ответить на любые вопросы, что для родителей невероятно важно. Спасибо вам за ваш труд, ответственность и искреннюю вовлечённость в судьбы наших детей. Мы очень рады, что обратились именно к вам, и с уверенностью рекомендуем вашу организацию другим родителям!',
  },
  {
    name: 'ABDUL QAYUM FARIDUN',
    photo: '/testimonials/faridun.jpg',
    university: 'Guangdong University of Business and Technology',
    program: 'Chinese Language and Culture (языковой курс, non-degree)',
    rating: 'Частный университет Китая, ориентирован на практическое обучение и международных студентов',
    text:
      'Я долго сомневался, стоит ли обращаться в агентства, но Grant China разрушили все стереотипы. С первой же консультации стало понятно: здесь действительно болеют за твой результат, а не просто отрабатывают заявку. Мне помогли буквально со всем: подобрали университет под мой профиль и бюджет, объяснили систему грантов без заумных терминов, подготовили сильный пакет документов и довели до визы без единой ошибки. Но самое ценное — поддержка не закончилась после зачисления. Мне помогли с жильём, рассказали, как адаптироваться, и даже просто спрашивали, как у меня дела в первую неделю в Китае. Это дорогого стоит. Если вы ищете компанию, которая проведёт вас за руку от идеи «хочу учиться в Китае» до реального студенческого билета — вам точно сюда. Огромное спасибо команде Grant China за профессионализм и человеческое отношение! 🔥',
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
