import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Region, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { GeminiError, GeminiTurn, callGemini } from './gemini';
import { buildStudentContext } from './student-context';

/**
 * ТЗ 6.1 — AI-помощник CRM. Работает на Google Gemini (решение заказчика).
 *
 * АРХИТЕКТУРА: это RAG, а НЕ дообучение модели. В каждый запрос собирается
 * контекст из двух частей — опубликованные статьи базы знаний и срез данных по
 * студентам, ДОСТУПНЫМ ИМЕННО ЭТОМУ сотруднику. Модель отвечает строго по ним.
 * Практические следствия, важные при эксплуатации:
 *  - правка статьи действует на следующий же вопрос, без «переобучения»;
 *  - помощник физически не может знать того, чего нет в контексте, — и обязан
 *    честно об этом сказать (прописано в системном промпте);
 *  - границы доступа НЕ ЗАДАЮТСЯ ПРОМПТОМ. Менеджер не видит чужих студентов
 *    не потому, что модель попросили о них не рассказывать, а потому, что их
 *    нет в присланных данных. Просьбу в промпте можно обойти уговорами,
 *    отсутствие данных — нельзя.
 *
 * ЧТО УХОДИТ ВО ВНЕШНИЙ СЕРВИС. Вопрос сотрудника, статьи базы знаний и
 * перечисленные факты по его студентам (ФИО, направление, этап, виза, суммы
 * оплат). Это персональные данные, покидающие сервер компании. Паспортных
 * данных, сканов документов и содержимого анкет среди них нет (см.
 * student-context.ts). Отключается снятием переменной GEMINI_API_KEY.
 */

/**
 * Модель по умолчанию — ПСЕВДОНИМ, а не конкретная версия. Это осознанный
 * выбор, проверенный на живом ключе.
 *
 * Здесь стояло 'gemini-2.5-pro', и на момент подключения ключа Google уже
 * отвечал по ней 404: «no longer available to new users». Проверка показала,
 * что и 'gemini-3-pro-preview' выведена из обращения. То есть закреплённое имя
 * версии — это отложенная поломка: модель тихо снимают, а помощник перестаёт
 * отвечать в тот день, когда это произойдёт, без единой правки с нашей стороны.
 *
 * 'gemini-pro-latest' всегда указывает на свежую Pro (на момент проверки —
 * gemini-3.1-pro-preview, что видно по modelVersion в ответе) и переживает
 * смену поколений сам. Плата за это — поведение модели может измениться без
 * предупреждения; для помощника по регламентам это приемлемо, он пересказывает
 * текст, а не решает задачи, где важна воспроизводимость до слова.
 *
 * Нужна фиксированная версия — задайте AI_MODEL, и тогда следите за
 * объявлениями Google сами.
 */
const DEFAULT_MODEL = 'gemini-pro-latest';

/**
 * Потолок длины ответа.
 *
 * Было 4096 — и на нём рвались реальные ответы: помощник перечислял 28
 * студентов и обрывался на середине шестой фамилии. Расчёт простой: одна
 * строка «фамилия + этап + статус» — около 30 токенов, значит 4096 хватало
 * едва на сотню строк вместе со вступлением и пояснениями.
 *
 * 16 000 покрывает перечисление всей базы агентства с запасом. Лимит остаётся
 * не ради экономии, а как предохранитель: без него неудачный вопрос вроде
 * «расскажи всё» превращается в многостраничную простыню, которую никто не
 * читает, и в счёт за токены, который никто не ждал.
 */
const MAX_OUTPUT_TOKENS = 16_000;

// Сколько предыдущих реплик уходит в запрос. Чат нужен ради уточняющих
// вопросов («а если чек не пришёл?») — без истории они бессмысленны. Но вся
// переписка за месяц только удорожает запрос и размывает фокус.
const HISTORY_TURNS = 12;

// Длина вопроса. Не про экономию, а про защиту эндпоинта: без ограничения
// сюда можно вставить мегабайт текста и оплатить его токенами компании.
const MAX_QUESTION_LENGTH = 2000;

// Сколько ждём ответа Gemini. Замеры на боевом объёме (202 студента в
// контексте, ~15 тыс. токенов на входе): Pro отвечает за 14–37 секунд, Flash —
// за 6. Разброс у Pro большой, поэтому запас нужен, но выше проксирующего слоя
// Vercel (~60 с) уходить нельзя — он оборвёт соединение первым.
const TIMEOUT_SEC = 55;

// Резервная модель на случай перегрузки основной. Flash, а не вторая Pro:
// перегрузка бьёт по всем версиям одного семейства разом (спрос мигрирует
// вслед за новинкой), а Flash живёт на отдельной, более дешёвой ёмкости и в
// день боевого инцидента с 503 у Pro отвечал стабильно за 6 секунд. Для
// пересказа регламентов и подсчётов по списку студентов его качества
// достаточно — проверено одинаковыми ответами обеих моделей на одинаковых
// вопросах.
const FALLBACK_MODEL = 'gemini-flash-latest';

export type CurrentUser = { id: string; role: Role | string; region?: Region | string | null };

export interface AiAskResult {
  answer: string;
  /** Сколько статей базы реально попало в контекст (для прозрачности в UI). */
  articles: number;
  /** Сколько студентов попало в контекст — сотрудник должен понимать охват ответа. */
  students: number;
  /** true — контекст не поместился целиком, ответ мог быть неполным. */
  truncated: boolean;
  model: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string | null;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private knowledge: KnowledgeService,
  ) {
    // GOOGLE_API_KEY принимается как запасное имя: под ним ключ выдают в части
    // консолей Google, и человек, вставивший его туда, не должен получить
    // молчаливо отключённого помощника.
    this.apiKey = config.get<string>('GEMINI_API_KEY') || config.get<string>('GOOGLE_API_KEY') || null;
    this.model = config.get<string>('AI_MODEL') || DEFAULT_MODEL;
    // Ключ опционален — ровно как у SMS/Telegram/почты: без него модуль просто
    // отключён, а не роняет приложение при старте. Об отключении явно пишем в
    // лог, иначе «помощник молчит» превращается в необъяснимую загадку.
    if (this.apiKey) {
      this.logger.log(`AI-помощник включён (Gemini, модель ${this.model})`);
    } else {
      this.logger.warn('AI-помощник отключён: не задан GEMINI_API_KEY');
    }
  }

  /** Доступен ли помощник — фронт прячет виджет, если ключ не настроен. */
  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Системный промпт. Всё, что делает помощника предсказуемым, живёт здесь:
   * язык, границы компетенции, требование ссылаться на источник и признавать
   * незнание. Формулировки намеренно позитивные («делай так»), а не
   * запретительные — так модель следует им точнее.
   */
  private buildSystemPrompt(args: {
    knowledge: string;
    knowledgeTruncated: boolean;
    students: string;
    studentsIncluded: number;
    studentsTotal: number;
    studentsTruncated: boolean;
    roleLabel: string;
  }): string {
    const blocks: string[] = [
      'Ты — внутренний помощник CRM-системы образовательного агентства GrantChina (Таджикистан → Китай).',
      `Сейчас с тобой говорит сотрудник с ролью «${args.roleLabel}».`,
      '',
      'Отвечай на русском языке, коротко и по делу. Сотрудник читает тебя между звонками:',
      'дай ответ или пошаговую инструкцию и остановись. Не пересказывай вопрос и не добавляй вступлений.',
      '',
      'У тебя два источника: раздел «База знаний» — правила и порядок работы агентства,',
      'и раздел «Студенты» — факты по конкретным людям. Отвечай ТОЛЬКО по ним.',
      'Если ответа нет ни там, ни там, так и скажи: «В моих данных этого нет».',
      'Не додумывай регламент и не опирайся на то, как это обычно устроено в других компаниях:',
      'у GrantChina свои правила, и выдуманный ответ дороже отсутствия ответа.',
      '',
      'Считая что-либо по списку студентов, приводи и число, и то, как ты его получил',
      '(например: «трое: Иванов, Петров, Сидоров»). Сотрудник должен иметь возможность проверить.',
      '',
      'В разделе «Студенты» перечислены ТОЛЬКО те, к кому у этого сотрудника есть доступ.',
      'Если он спрашивает про человека, которого в списке нет, — скажи, что такого студента',
      'в доступных тебе данных нет, и не строй догадок о нём.',
      '',
      'Когда ответ опирается на статью базы знаний, назови её заголовок в конце —',
      'так сотрудник откроет первоисточник и проверит.',
    ];

    if (args.knowledgeTruncated) {
      blocks.push(
        '',
        'ВНИМАНИЕ: база знаний не поместилась целиком. Если вопрос выглядит так, будто ответ',
        'должен быть в базе, но ты его не видишь — предупреди сотрудника об этом.',
      );
    }
    if (args.studentsTruncated) {
      blocks.push(
        '',
        `ВНИМАНИЕ: тебе показаны ${args.studentsIncluded} студентов из ${args.studentsTotal} доступных.`,
        'Отвечая на вопросы «сколько» и «у кого», обязательно предупреждай, что видишь не всех.',
      );
    }

    blocks.push('', '# База знаний', '');
    blocks.push(args.knowledge || '(база знаний пока пуста — сообщи об этом сотруднику)');

    blocks.push('', '# Студенты', '');
    blocks.push(
      args.students ||
        '(доступных тебе студентов нет — на вопросы о конкретных людях отвечай, что данных нет)',
    );

    return blocks.join('\n');
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

  private roleLabel(role: Role | string): string {
    if (role === 'FOUNDER') return 'Основатель';
    if (role === 'ADMIN') return 'Администратор';
    return 'Менеджер';
  }

  /** Переводит ошибку Gemini в понятное сотруднику сообщение. */
  private translateError(e: GeminiError): never {
    // 400 с текстом про ключ и 401/403 — это всегда неверный или отозванный
    // ключ. Отдельное сообщение, потому что чинит его администратор, а не
    // пользователь: без явного указания причины он будет ждать «когда починится».
    if (e.status === 401 || e.status === 403 || /api key/i.test(e.detail ?? '')) {
      this.logger.error(`AI: ключ отклонён (${e.status}): ${e.detail ?? e.message}`);
      throw new ServiceUnavailableException(
        'AI-помощник: ключ доступа отклонён. Проверьте переменную GEMINI_API_KEY.',
      );
    }
    if (e.status === 404) {
      this.logger.error(`AI: модель «${this.model}» не найдена: ${e.detail ?? e.message}`);
      throw new ServiceUnavailableException(
        `AI-помощник: модель «${this.model}» недоступна для этого ключа. Укажите другую в переменной AI_MODEL.`,
      );
    }
    if (e.status === 429) {
      throw new ServiceUnavailableException('AI-помощник перегружен запросами. Попробуйте через минуту.');
    }
    if (e.status === 504) {
      throw new ServiceUnavailableException(
        `AI-помощник не ответил за ${TIMEOUT_SEC} секунд. Попробуйте ещё раз или задайте вопрос короче. ` +
          'Если повторяется — переключите AI_MODEL на gemini-flash-latest, он отвечает вдвое быстрее.',
      );
    }
    if (e.status === 502) {
      throw new ServiceUnavailableException(
        `AI-помощник: нет связи с сервисом Google. ${e.detail ? `Причина: ${e.detail.slice(0, 160)}` : ''}`.trim(),
      );
    }
    // Остальные коды — показываем причину, а не прячем её за «временно
    // недоступен».
    //
    // Именно эта фраза уже стоила часа разбирательств: помощник упал в проде,
    // а сообщение не отличало «Google вернул 500» от «мы отправили негодный
    // запрос». Причину пришлось бы искать в логах Railway, куда владелец
    // системы обычно не ходит.
    //
    // Текст ошибки Google секретов не содержит (ключ туда не попадает), а
    // человеку, который видит «Google: 500 Internal error», сразу понятно:
    // это не у нас сломалось, надо просто повторить.
    const reason = (e.detail ?? e.message ?? '').slice(0, 200);
    this.logger.error(`AI: ошибка ${e.status}: ${e.detail ?? e.message}`);
    throw new ServiceUnavailableException(
      `AI-помощник не смог ответить. Ошибка сервиса Google (код ${e.status})${reason ? `: ${reason}` : ''}`,
    );
  }

  async ask(question: string, user: CurrentUser): Promise<AiAskResult> {
    const text = (question || '').trim();
    if (!text) throw new BadRequestException('Введите вопрос');
    if (text.length > MAX_QUESTION_LENGTH) {
      throw new BadRequestException(`Вопрос слишком длинный (максимум ${MAX_QUESTION_LENGTH} символов)`);
    }
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'AI-помощник не настроен: администратору нужно задать GEMINI_API_KEY в переменных окружения.',
      );
    }

    const [knowledge, studentsCtx, priorRaw] = await Promise.all([
      this.knowledge.buildContext(),
      buildStudentContext(this.prisma, user),
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

    // Первой репликой обязан быть вопрос пользователя — если история почему-то
    // начинается с ответа помощника (старые записи после чистки), отрезаем
    // ведущие ответы, иначе API отклонит запрос.
    while (prior.length && prior[0].role !== 'user') prior.shift();

    const turns: GeminiTurn[] = [
      ...prior.map((m) => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as GeminiTurn['role'],
        text: m.content,
      })),
      { role: 'user' as const, text },
    ];

    const system = this.buildSystemPrompt({
      knowledge: knowledge.text,
      knowledgeTruncated: knowledge.truncated,
      students: studentsCtx.text,
      studentsIncluded: studentsCtx.included,
      studentsTotal: studentsCtx.total,
      studentsTruncated: studentsCtx.truncated,
      roleLabel: this.roleLabel(user.role),
    });
    const callWith = (model: string) =>
      callGemini({
        model,
        apiKey: this.apiKey!,
        system,
        turns,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        timeoutSec: TIMEOUT_SEC,
      });

    let result;
    try {
      result = await callWith(this.model);
    } catch (e) {
      // 503 «model is experiencing high demand» и 429 — перегрузка КОНКРЕТНОЙ
      // модели, а не сервиса целиком: свежая Pro пала под спросом, Flash в тот
      // же момент отвечал за 6 секунд (проверено в день, когда это случилось
      // в проде). Показывать сотруднику «попробуйте позже», когда рядом стоит
      // работающая модель, — значит превращать чужую перегрузку в наш простой.
      //
      // Поэтому: перегружена основная — молча пробуем резервную. Ответ придёт
      // от неё, поле model в истории честно покажет, кто отвечал. Если и
      // резервная лежит — вот теперь это правда «Google перегружен», и об этом
      // скажет translateError по её ошибке.
      const overloaded = e instanceof GeminiError && (e.status === 503 || e.status === 429);
      if (overloaded && this.model !== FALLBACK_MODEL) {
        this.logger.warn(
          `AI: модель «${this.model}» перегружена (${(e as GeminiError).status}), переключаюсь на «${FALLBACK_MODEL}»`,
        );
        try {
          result = await callWith(FALLBACK_MODEL);
        } catch (e2) {
          if (e2 instanceof GeminiError) this.translateError(e2);
          throw e2;
        }
      } else {
        if (e instanceof GeminiError) this.translateError(e);
        throw e;
      }
    }

    /**
     * ВАЖНО про MAX_TOKENS. Раньше эта ветка срабатывала только когда
     * result.text ПУСТОЙ — то есть модель не успела написать ни слова. Но
     * типичный обрыв выглядит иначе: модель перечисляет студентов, упирается
     * в потолок и возвращает НЕПУСТОЙ текст, оборванный на полуслове. Такой
     * ответ уходил сотруднику как есть — без единого признака, что список
     * неполный. Человек читал 6 фамилий из 28 и считал, что это все.
     *
     * Теперь обрыв дописывается к самому ответу: правило проекта — никаких
     * тихих обрезаний, ни в данных, ни в тексте.
     */
    const truncatedNotice =
      '\n\n---\n**Ответ пришлось оборвать — он не поместился целиком.** Показанное выше верно, но список неполный. Спросите про конкретную группу (например, «кто на этапе 1 без визы») либо откройте раздел «Студенты» с фильтром.';

    let answer: string;
    if (result.text) {
      answer = result.finishReason === 'MAX_TOKENS' ? result.text + truncatedNotice : result.text;
    } else {
      answer =
        result.finishReason === 'MAX_TOKENS'
          ? 'Ответ получился слишком длинным. Задайте вопрос уже — например, про один конкретный шаг.'
          : result.finishReason === 'SAFETY'
            ? 'Не могу ответить на этот вопрос. Переформулируйте его в терминах работы с CRM.'
            : 'Не удалось получить ответ. Попробуйте переформулировать вопрос.';
    }

    // Сохраняем обе реплики ОДНОЙ транзакцией: половина диалога в базе хуже,
    // чем его отсутствие — при следующем вопросе модель получила бы вопрос
    // без ответа и решила бы, что отвечать не нужно.
    await this.prisma.$transaction([
      this.prisma.aiChatMessage.create({
        data: { userId: user.id, role: 'user', content: text },
      }),
      this.prisma.aiChatMessage.create({
        data: {
          userId: user.id,
          role: 'assistant',
          content: answer,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      }),
    ]);

    return {
      answer,
      articles: knowledge.articles,
      students: studentsCtx.included,
      truncated: knowledge.truncated || studentsCtx.truncated,
      model: result.model,
    };
  }
}
