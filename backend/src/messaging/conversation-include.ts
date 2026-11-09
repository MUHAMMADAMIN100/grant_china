import { Prisma } from '@prisma/client';

/**
 * Строка диалога для списка в CRM — одна и та же в ответе API и в событии
 * вебсокета (09.11.2026: сообщения Instagram приходят на экран сразу, без
 * повторного запроса). Отдельный файл — чтобы messaging.service и
 * meta-chats.service не импортировали друг друга по кругу.
 */
export const CONVERSATION_INCLUDE = {
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  application: { select: { id: true, fullName: true, status: true, managerId: true, chinaManagerId: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.ConversationInclude;
