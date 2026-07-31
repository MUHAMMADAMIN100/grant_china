import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

/**
 * ТЗ 6.1 — AI-помощник по внутренним регламентам CRM.
 *
 * АРХИТЕКТУРА: это RAG, а НЕ дообучение модели. Все опубликованные статьи базы
 * знаний собираются в системный промпт запроса, и модель отвечает строго по
 * ним. Практические следствия, которые важно понимать при эксплуатации:
 *  - правка статьи действует на следующий же вопрос, без «переобучения»;
 *  - помощник физически не может знать того, чего нет в базе, — и обязан
 *    честно об этом сказать (это прописано в системном промпте);
 *  - помощник НЕ ходит в базу данных CRM. Он объясняет, КАК сделать действие,
 *    но не отвечает на «сколько денег принёс Иванов» — доступ к персональным
 *    и финансовым данным идёт только через обычные эндпоинты с проверкой прав.
 *
 * СТОИМОСТЬ. Системный промпт (вся база знаний) одинаков у всех запросов, и на
 * нём включено кэширование: повторные обращения читают его примерно в десять
 * раз дешевле. Поэтому «дорогая» часть промпта оплачивается один раз в
 * пять минут, а не на каждый вопрос сотрудника.
 */

// Модель по умолчанию. Вынесена в env, чтобы Основатель мог переключиться
// на более дешёвую без передеплоя кода (тот же приём, что у SMS_PROVIDER).
const DEFAULT_MODEL = 'claude-opus-5';

// Помощник отвечает короткими пошаговыми инструкциями, а не эссе. Лимит
// сознательно небольшой: он и ограничивает стоимость ответа, и работает как
// страховка от «простыни» при неудачно сформулированном вопросе.
const MAX_TOKENS = 4096;

// Сколько предыдущих реплик диалога уходит в запрос. Чат нужен ради
// уточняющих вопросов («а если чек не пришёл?»), и без истории они
// бессмысленны; но вся переписка за месяц в контекст не нужна — она только
// удорожает запрос и размывает фокус.
const HISTORY_TURNS = 12;

// Длина вопроса. Не про экономию, а про защиту эндпоинта: без ограничения
// сюда можно вставить мегабайт текста и оплатить его токенами компании.
const MAX_QUESTION_LENGTH = 2000;

export type CurrentUser = { id: string; role: string };

export interface AiAskResult {
  answer: string;
  /** Сколько статей базы реально попало в контекст (для прозрачности в UI). */
  articles: number;
  /** true — база не влезла в контекст целиком, ответ мог быть неполным. */
  truncated: boolean;
  model: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private knowledge: KnowledgeService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY') || null;
    this.model = config.get<string>('AI_MODEL') || DEFAULT_MODEL;
    // Ключ опционален — ровно как у SMS/Telegram/почты: без него модуль просто
    // отключён, а не роняет приложение при старте. Об отключении явно пишем в
    // лог, иначе «помощник молчит» превращается в необъяснимую загадку.
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log(`AI-помощник включён (модель ${this.model})`);
    } else {
      this.client = null;
      this.logger.warn('AI-помощник отключён: не задан ANTHROPIC_API_KEY');
    }
  }

  /** Доступен ли помощник — фронт прячет виджет, если ключ не настроен. */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Системный промпт. Всё, что делает помощника предсказуемым, живёт здесь:
   * язык, границы компетенции, требование ссылаться на статью и признавать
   * незнание. Формулировки намеренно позитивные («делай так»), а не
   * запретительные — так модель следует им точнее.
   */
  private buildSystemPrompt(context: string, truncated: boolean): string {
    return [
      'Ты — внутренний помощник CRM-системы образовательного агентства GrantChina (Таджикистан → Китай).',
      'Твои пользователи — сотрудники агентства: менеджеры, администраторы, основатель.',
      '',
      'Отвечай на русском языке, коротко и по шагам. Сотрудник читает тебя между звонками —',
      'дай пошаговую инструкцию и остановись. Не пересказывай вопрос и не добавляй вступлений.',
      '',
      'Отвечай ТОЛЬКО на основании раздела «База знаний» ниже. Если ответа там нет, так и скажи:',
      '«В базе знаний нет ответа на этот вопрос — уточните у Основателя или администратора».',
      'Не додумывай регламент и не опирайся на то, как это обычно устроено в других компаниях:',
      'у GrantChina свои правила, и выдуманный ответ здесь дороже отсутствия ответа.',
      '',
      'Когда ответ опирается на конкретную статью, назови её заголовок в конце — так сотрудник',
      'сможет открыть первоисточник и проверить.',
      '',
      'Ты не имеешь доступа к данным CRM: не отвечай на вопросы о конкретных студентах, суммах,',
      'платежах или сотрудниках. На такой вопрос объясни, в каком разделе CRM эти данные смотрят.',
      truncated
        ? '\nВНИМАНИЕ: база знаний не поместилась в контекст целиком. Если вопрос выглядит так, будто ответ должен быть в базе, но ты его не видишь — предупреди сотрудника об этом.'
        : '',
      '',
      '# База знаний',
      '',
      context || '(база знаний пока пуста — сообщи об этом сотруднику и предложи обратиться к администратору)',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** История диалога сотрудника — только его собственная (userId из JWT). */
  async history(userId: string) {
    // Берём ПОСЛЕДНИЕ 200 сообщений (desc + reverse), а не первые: с asc + take
    // сотрудник, задавший больше двухсот вопросов, видел бы навсегда
    // застывшую переписку годичной давности и ни одного своего свежего ответа.
    const rows = await this.prisma.aiChatMessage.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return { items: rows.reverse(), enabled: this.isEnabled() };
  }

  /** Очистить свою переписку (soft-delete — правило проекта №1). */
  async clearHistory(userId: string) {
    await this.prisma.aiChatMessage.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async ask(question: string, user: CurrentUser): Promise<AiAskResult> {
    const text = (question || '').trim();
    if (!text) throw new BadRequestException('Введите вопрос');
    if (text.length > MAX_QUESTION_LENGTH) {
      throw new BadRequestException(`Вопрос слишком длинный (максимум ${MAX_QUESTION_LENGTH} символов)`);
    }
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI-помощник не настроен: администратору нужно задать ANTHROPIC_API_KEY в переменных окружения.',
      );
    }

    const [context, priorRaw] = await Promise.all([
      this.knowledge.buildContext(),
      this.prisma.aiChatMessage.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_TURNS,
        select: { role: true, content: true },
      }),
    ]);

    // findMany отдал историю новыми вперёд (так работает индекс) — разворачиваем
    // в хронологический порядок, иначе модель прочитает диалог задом наперёд.
    const prior = priorRaw.reverse();

    // Первым сообщением обязан быть 'user' — если история почему-то начинается
    // с ответа помощника (например, старые записи после чистки), отрезаем
    // ведущие 'assistant', иначе API отклонит запрос.
    while (prior.length && prior[0].role !== 'user') prior.shift();

    const messages: Anthropic.MessageParam[] = [
      ...prior.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
      { role: 'user' as const, content: text },
    ];

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // Кэширование системного промпта: база знаний одинакова у всех
        // запросов и меняется редко, поэтому её обработка оплачивается один
        // раз, а последующие вопросы читают её примерно в 10 раз дешевле.
        // Ставим метку на последний (и единственный) системный блок — всё,
        // что до неё, кэшируется целиком.
        system: [
          {
            type: 'text',
            text: this.buildSystemPrompt(context.text, context.truncated),
            cache_control: { type: 'ephemeral' },
          },
        ],
        // Уровень «усилий» (output_config.effort) здесь НЕ задаётся намеренно:
        // установленная версия SDK этот параметр ещё не поддерживает, а
        // отправлять его в обход типов — верный способ получить 400 в проде.
        // Помощнику по регламентам глубокое рассуждение и не требуется: ответ
        // лежит в тексте базы, задача — найти и изложить.
        messages,
      });
    } catch (e) {
      // Типизированные исключения SDK вместо разбора текста ошибки.
      if (e instanceof Anthropic.AuthenticationError) {
        this.logger.error('AI: ключ ANTHROPIC_API_KEY отклонён');
        throw new ServiceUnavailableException('AI-помощник: ключ доступа отклонён. Проверьте ANTHROPIC_API_KEY.');
      }
      if (e instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException('AI-помощник перегружен запросами. Попробуйте через минуту.');
      }
      if (e instanceof Anthropic.APIConnectionError) {
        throw new ServiceUnavailableException('AI-помощник недоступен: нет связи с сервисом. Попробуйте позже.');
      }
      if (e instanceof Anthropic.APIError) {
        this.logger.error(`AI: ошибка API ${e.status}: ${e.message}`);
        throw new ServiceUnavailableException('AI-помощник временно недоступен. Попробуйте позже.');
      }
      throw e;
    }

    // Проверяем stop_reason ДО чтения content: при отказе классификатора
    // массив content пуст, и обращение к content[0] упало бы с TypeError.
    if (response.stop_reason === 'refusal') {
      return {
        answer:
          'Не могу ответить на этот вопрос. Переформулируйте его в терминах работы с CRM ' +
          'или обратитесь к Основателю.',
        articles: context.articles,
        truncated: context.truncated,
        model: response.model,
      };
    }

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const finalAnswer =
      answer ||
      (response.stop_reason === 'max_tokens'
        ? 'Ответ получился слишком длинным. Задайте вопрос уже — например, про один конкретный шаг.'
        : 'Не удалось получить ответ. Попробуйте переформулировать вопрос.');

    // Сохраняем обе реплики ОДНОЙ транзакцией: половина диалога в базе хуже,
    // чем его отсутствие — при следующем вопросе модель получила бы вопрос
    // без ответа и решила бы, что на него отвечать не нужно.
    await this.prisma.$transaction([
      this.prisma.aiChatMessage.create({
        data: { userId: user.id, role: 'user', content: text },
      }),
      this.prisma.aiChatMessage.create({
        data: {
          userId: user.id,
          role: 'assistant',
          content: finalAnswer,
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      }),
    ]);

    return {
      answer: finalAnswer,
      articles: context.articles,
      truncated: context.truncated,
      model: response.model,
    };
  }
}
