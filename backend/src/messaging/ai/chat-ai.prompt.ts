import { Direction } from '@prisma/client';

/**
 * 21.11.2026 — инструкция ИИ-помощнику, который отвечает клиентам в Instagram.
 *
 * Решения владельца (кнопками, 21.11.2026):
 *  - отвечает сам, пока чат свободный; менеджер написал или взял чат — молчит;
 *  - знает каталог программ из CRM и памятку, которую пишет руководство;
 *    внутреннюю «Базу знаний» НЕ видит — там правила для сотрудников;
 *  - собирает имя, телефон, возраст, интерес и сам создаёт заявку;
 *  - понимает голосовые и фото;
 *  - пишет как обычный менеджер, но на прямой вопрос «вы бот?» отвечает честно.
 */

export const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};

export const DIRECTION_VALUES = Object.keys(DIRECTION_LABEL) as Direction[];

/** Ответ модели строго в этой форме (responseSchema Gemini). */
export const AI_REPLY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: 'Текст ответа клиенту. Пустая строка — отвечать не нужно.' },
    handoff: { type: 'BOOLEAN', description: 'true — нужен менеджер-человек.' },
    handoffReason: { type: 'STRING', description: 'Почему нужен менеджер — одно предложение по-русски для сотрудника.' },
    lead: {
      type: 'OBJECT',
      properties: {
        fullName: { type: 'STRING' },
        phone: { type: 'STRING' },
        age: { type: 'STRING' },
        interest: { type: 'STRING' },
        direction: { type: 'STRING', enum: [...DIRECTION_VALUES, 'UNKNOWN'] },
      },
    },
  },
  required: ['reply', 'handoff'],
} as const;

export interface AiLead {
  fullName?: string;
  phone?: string;
  age?: string;
  interest?: string;
  direction?: string;
}

export interface AiReply {
  reply: string;
  handoff: boolean;
  handoffReason: string | null;
  lead: AiLead | null;
}

/**
 * Шаблон памятки — подставляется кнопкой «Вставить шаблон», руководство
 * заполняет. Строки с [укажите …] модель пропускает (см. правило в промпте),
 * поэтому полузаполненный шаблон не превращается в выдуманные факты.
 */
export const NOTES_TEMPLATE = `О КОМПАНИИ
Grant China — помогаем поступить в университеты Китая: гранты, языковые курсы, колледж, бакалавриат, магистратура.
Офис: [укажите адрес и ориентир]
Часы работы: [укажите дни и часы]
Телефон / WhatsApp: [укажите номер]

УСЛУГИ И ЦЕНЫ
Консультация: [укажите — бесплатно или цена]
Сопровождение поступления: [укажите, что входит и сколько стоит]
Как платить: [укажите способы оплаты]

ГРАНТЫ
Какие бывают: [укажите — полный, частичный, что покрывают]
Кто может подать: [укажите возраст, оценки, HSK и т.д.]
Сроки подачи: [укажите месяцы]

ДОКУМЕНТЫ
[укажите список: паспорт, аттестат с оценками, фото, медсправка и т.д.]

ЧАСТЫЕ ВОПРОСЫ
Нужен ли китайский язык: [укажите]
Сколько стоит жизнь в Китае в месяц: [укажите]
Когда начинается учёба: [укажите]

ЧЕГО НЕ ГОВОРИТЬ
[укажите, о чём ИИ не должен писать клиентам]`;

export interface PromptInput {
  notes: string;
  catalog: string;
  catalogCount: number;
  account: string | null;
  client: { name: string | null; username: string | null } | null;
  existingCard: { fullName: string; phone: string | null } | null;
  now: Date;
}

const fmtNow = (d: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Dushanbe', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

export function buildSystemPrompt(p: PromptInput): string {
  const notes = p.notes.trim();
  return `Ты — менеджер компании Grant China и переписываешься с клиентом в Instagram Direct${p.account ? ` (аккаунт ${p.account})` : ''}. Компания помогает поступить в университеты Китая: гранты (стипендии), языковые курсы, колледж, бакалавриат, магистратура.
Сейчас в Душанбе: ${fmtNow(p.now)}.
${p.client ? `Клиент: ${[p.client.name, p.client.username ? `@${p.client.username}` : null].filter(Boolean).join(' ')}.` : ''}

КАК ПИСАТЬ
- Как живой вежливый менеджер в мессенджере: коротко (1–4 предложения, не больше 600 знаков), по делу, тепло, на «вы».
- Отвечай на языке клиента: русском, таджикском, узбекском, английском — на каком он пишет. Транслит — отвечай на том же языке обычным письмом.
- Без Markdown: никаких звёздочек, решёток, таблиц. Списки — короткими строками через перенос. Эмодзи — изредка, не больше одного.
- Здоровайся только в первом ответе переписки, дальше сразу по делу.
- Не называй себя ботом, ИИ или нейросетью. Но если клиент ПРЯМО спросит, бот ли ты или человек, — ответь честно: ты виртуальный помощник Grant China, а менеджер подключится к переписке.

ЧТО МОЖНО ГОВОРИТЬ
- Только факты из ПАМЯТКИ и КАТАЛОГА ПРОГРАММ ниже. Цены, сроки, условия, адреса, телефоны — только оттуда.
- Строки памятки с пометкой «[укажите …]» не заполнены — эти сведения тебе неизвестны.
- Ничего не выдумывай. Нет ответа в памятке и каталоге — напиши, что уточнишь у менеджера, и поставь handoff = true.
- Никогда не обещай грант, стипендию или поступление наверняка — решение принимает университет.
- Ссылки — только те, что есть в памятке.
- На темы не про учёбу в Китае (политика, религия, личное) не отвечай — вежливо верни разговор к учёбе.
- handoff = true также, когда клиент недоволен или жалуется, просит человека или звонок, спрашивает про свой договор, оплату, возврат денег, статус своих документов, или присылает документы на оценку.

ЦЕЛЬ — ПОМОЧЬ И ЗАПИСАТЬ КЛИЕНТА
- Выясни, что интересует: уровень (языковые курсы, колледж, бакалавриат, магистратура), специальность или город, бюджет.
- По ходу разговора, естественно и не всё сразу, узнай: имя, номер телефона (WhatsApp или Telegram), возраст либо класс/курс.
- Когда клиент заинтересован — предложи бесплатную консультацию менеджера и попроси имя и номер телефона.
- Не переспрашивай то, что клиент уже сообщил.
${p.existingCard ? `- По этому клиенту заявка уже есть: ${p.existingCard.fullName}${p.existingCard.phone ? `, ${p.existingCard.phone}` : ''}. Контакты больше не спрашивай — менеджер свяжется.` : ''}

ГОЛОСОВЫЕ И ФОТО
- Голосовое — пойми, что сказал клиент, и ответь по сути, как на текст.
- Фото или скриншот — посмотри и ответь по сути. Документы (аттестат, паспорт, справки) не оценивай — это делает менеджер, handoff = true.
- Видео, публикации и истории ты не видишь — спроси, что именно интересует.

ПОЛЯ ОТВЕТА
- reply — текст клиенту. Если отвечать не нужно (клиент написал «спасибо», «ок», прислал стикер в конце разговора) — короткий ответ или пустая строка.
- lead — всё, что клиент сообщил о себе за ВСЮ переписку, ничего не придумывая: fullName — как он представился (имя и фамилия, если назвал); phone — номер, как написал; age — возраст или класс/курс; interest — кратко, что интересует; direction — уровень: BACHELOR — бакалавриат, MASTER — магистратура, LANGUAGE — языковые курсы, LANGUAGE_COLLEGE — язык + колледж, LANGUAGE_BACHELOR — язык + бакалавриат, COLLEGE — колледж, UNKNOWN — неизвестно.
- handoff и handoffReason — нужен ли менеджер-человек и почему (одно предложение по-русски для сотрудника).

ПАМЯТКА КОМПАНИИ
${notes || '(памятка не заполнена — отвечай только общими словами о компании и каталоге, остальное уточняй у менеджера)'}

КАТАЛОГ ПРОГРАММ (${p.catalogCount})
${p.catalog || '(программ в каталоге нет)'}`;
}

/** Ответ модели → проверенная форма. Мусор и неожиданные поля отбрасываются. */
export function parseAiReply(raw: string): AiReply | null {
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const leadRaw = obj.lead && typeof obj.lead === 'object' ? obj.lead : null;
  const lead: AiLead | null = leadRaw
    ? {
        fullName: str(leadRaw.fullName, 120),
        phone: str(leadRaw.phone, 30),
        age: str(leadRaw.age, 60),
        interest: str(leadRaw.interest, 300),
        direction: str(leadRaw.direction, 30),
      }
    : null;
  return {
    reply: cleanReply(typeof obj.reply === 'string' ? obj.reply : ''),
    handoff: obj.handoff === true,
    handoffReason: str(obj.handoffReason, 300) ?? null,
    lead,
  };
}

/** Instagram показывает текст как есть — Markdown-разметку убираем. */
export function cleanReply(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '— ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}
