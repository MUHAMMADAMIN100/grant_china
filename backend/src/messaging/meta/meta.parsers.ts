import type { MetaChannel } from './meta.config';

/**
 * 29.10.2026 — разбор уведомлений Meta в общий список событий.
 *
 * Дальше CRM работает с этими событиями и не знает, из какого мессенджера они
 * пришли. Сломанная запись внутри уведомления пропускается и не портит
 * остальные. Тексты клиентов здесь в журнал не пишутся.
 */

export interface IncomingAttachment {
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'STICKER' | 'SHARE' | 'REEL' | 'STORY' | 'LOCATION' | 'CONTACT' | 'UNSUPPORTED';
  url?: string | null;
  mediaId?: string | null;
  mimeType?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

export type ChatEvent =
  | {
      type: 'message';
      channel: MetaChannel;
      accountId: string;
      contactId: string;
      externalId: string;
      /** true — наше собственное сообщение (эхо Instagram или ответ из приложения). */
      echo: boolean;
      text: string | null;
      sentAt: Date;
      attachments: IncomingAttachment[];
      replyToExternalId?: string | null;
      contactName?: string | null;
      contactPhone?: string | null;
    }
  | { type: 'deleted'; channel: MetaChannel; accountId: string; contactId: string; externalId: string }
  | { type: 'reaction'; channel: MetaChannel; accountId: string; contactId: string; externalId: string; emoji: string | null }
  | { type: 'read'; channel: MetaChannel; accountId: string; contactId: string; at: Date }
  | { type: 'status'; channel: 'WHATSAPP'; accountId: string; externalId: string; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; errorCode: number | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : v != null && typeof v === 'number' ? String(v) : null);

// ------------------------------------------------------------ Instagram

const IG_KIND: Record<string, IncomingAttachment['kind']> = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  file: 'FILE',
  sticker: 'STICKER',
  share: 'SHARE',
  ig_reel: 'REEL',
  reel: 'REEL',
  story_mention: 'STORY',
  ig_story: 'STORY',
  location: 'LOCATION',
};

export function parseInstagramWebhook(body: any): { events: ChatEvent[]; skipped: number } {
  const events: ChatEvent[] = [];
  let skipped = 0;
  if (body?.object !== 'instagram' || !Array.isArray(body?.entry)) return { events, skipped: 1 };
  for (const entry of body.entry) {
    const accountId = str(entry?.id) ?? '';
    // Настоящие сообщения — entry[].messaging[]; кнопка «Тестировать» в кабинете
    // кладёт те же объекты в entry[].changes[].value. Читаем оба места.
    const raw: any[] = [];
    if (Array.isArray(entry?.messaging)) raw.push(...entry.messaging);
    if (Array.isArray(entry?.changes)) for (const ch of entry.changes) if (ch?.value) raw.push(ch.value);
    for (const m of raw) {
      try {
        const ev = parseInstagramItem(m, accountId);
        if (ev) events.push(ev);
        else skipped++;
      } catch {
        skipped++;
      }
    }
  }
  return { events, skipped };
}

function parseInstagramItem(m: any, accountId: string): ChatEvent | null {
  const sender = str(m?.sender?.id);
  const recipient = str(m?.recipient?.id);
  if (!sender || !recipient) return null;
  const at = typeof m?.timestamp === 'number' ? new Date(m.timestamp) : str(m?.timestamp) ? new Date(Number(m.timestamp)) : new Date();
  const sentAt = Number.isNaN(at.getTime()) ? new Date() : at;
  // Эхо: is_echo или отправитель — наш аккаунт. Тогда беседа — с получателем.
  const echo = m?.message?.is_echo === true || sender === accountId;
  const contactId = echo ? recipient : sender;

  if (m?.reaction) {
    const mid = str(m.reaction.mid);
    if (!mid) return null;
    const emoji = m.reaction.action === 'unreact' ? null : str(m.reaction.emoji) ?? str(m.reaction.reaction);
    return { type: 'reaction', channel: 'INSTAGRAM', accountId, contactId, externalId: mid, emoji };
  }
  if (m?.read) return { type: 'read', channel: 'INSTAGRAM', accountId, contactId, at: sentAt };
  if (m?.postback) {
    const mid = str(m.postback.mid) ?? `postback-${sender}-${sentAt.getTime()}`;
    return { type: 'message', channel: 'INSTAGRAM', accountId, contactId, externalId: mid, echo: false, text: str(m.postback.title) ?? str(m.postback.payload), sentAt, attachments: [] };
  }
  const msg = m?.message;
  if (!msg) return null;
  const mid = str(msg.mid);
  if (!mid) return null;
  if (msg.is_deleted === true) return { type: 'deleted', channel: 'INSTAGRAM', accountId, contactId, externalId: mid };
  const attachments: IncomingAttachment[] = [];
  if (Array.isArray(msg.attachments)) {
    for (const a of msg.attachments) {
      const kind = IG_KIND[String(a?.type ?? '')] ?? 'UNSUPPORTED';
      attachments.push({ kind, url: str(a?.payload?.url), name: str(a?.payload?.title) });
    }
  }
  if (msg.reply_to?.story?.url) attachments.push({ kind: 'STORY', url: str(msg.reply_to.story.url) });
  return {
    type: 'message',
    channel: 'INSTAGRAM',
    accountId,
    contactId,
    externalId: mid,
    echo,
    text: str(msg.text),
    sentAt,
    attachments,
    replyToExternalId: str(msg.reply_to?.mid),
  };
}

// ------------------------------------------------------------ WhatsApp

export function parseWhatsAppWebhook(body: any): { events: ChatEvent[]; skipped: number } {
  const events: ChatEvent[] = [];
  let skipped = 0;
  if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body?.entry)) return { events, skipped: 1 };
  for (const entry of body.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages' || !change?.value) {
        skipped++;
        continue;
      }
      const v = change.value;
      const accountId = str(v?.metadata?.phone_number_id) ?? '';
      const names = new Map<string, string>();
      for (const c of Array.isArray(v?.contacts) ? v.contacts : []) {
        const id = str(c?.wa_id);
        const name = str(c?.profile?.name);
        if (id && name) names.set(id, name);
      }
      for (const m of Array.isArray(v?.messages) ? v.messages : []) {
        try {
          const ev = parseWhatsAppMessage(m, accountId, names);
          if (ev) events.push(ev);
          else skipped++;
        } catch {
          skipped++;
        }
      }
      for (const s of Array.isArray(v?.statuses) ? v.statuses : []) {
        const id = str(s?.id);
        const st = String(s?.status ?? '').toUpperCase();
        if (!id || !['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(st)) {
          skipped++;
          continue;
        }
        const code = Array.isArray(s?.errors) && typeof s.errors[0]?.code === 'number' ? s.errors[0].code : null;
        events.push({ type: 'status', channel: 'WHATSAPP', accountId, externalId: id, status: st as any, errorCode: code });
      }
    }
  }
  return { events, skipped };
}

function parseWhatsAppMessage(m: any, accountId: string, names: Map<string, string>): ChatEvent | null {
  const id = str(m?.id);
  const from = str(m?.from);
  const type = String(m?.type ?? '');
  // system / request_welcome — не сообщения клиента.
  if (!id || !from || type === 'system' || type === 'request_welcome') return null;
  const ts = Number(m?.timestamp);
  const sentAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  const base = { channel: 'WHATSAPP' as const, accountId, contactId: from };

  if (type === 'reaction') {
    const target = str(m?.reaction?.message_id);
    if (!target) return null;
    return { type: 'reaction', ...base, externalId: target, emoji: str(m?.reaction?.emoji) };
  }
  let text: string | null = null;
  const attachments: IncomingAttachment[] = [];
  const media = (kind: IncomingAttachment['kind'], o: any) => {
    attachments.push({ kind, mediaId: str(o?.id), mimeType: str(o?.mime_type), name: str(o?.filename) });
    text = str(o?.caption);
  };
  switch (type) {
    case 'text':
      text = str(m?.text?.body);
      break;
    case 'image':
      media('IMAGE', m.image);
      break;
    case 'video':
      media('VIDEO', m.video);
      break;
    case 'audio':
      media('AUDIO', m.audio);
      break;
    case 'document':
      media('FILE', m.document);
      break;
    case 'sticker':
      media('STICKER', m.sticker);
      break;
    case 'location':
      attachments.push({
        kind: 'LOCATION',
        latitude: typeof m?.location?.latitude === 'number' ? m.location.latitude : Number(m?.location?.latitude),
        longitude: typeof m?.location?.longitude === 'number' ? m.location.longitude : Number(m?.location?.longitude),
        name: str(m?.location?.name),
        address: str(m?.location?.address),
      });
      break;
    case 'contacts':
      for (const c of Array.isArray(m?.contacts) ? m.contacts : []) {
        const phone = Array.isArray(c?.phones) ? str(c.phones[0]?.phone) ?? str(c.phones[0]?.wa_id) : null;
        attachments.push({ kind: 'CONTACT', name: str(c?.name?.formatted_name) ?? str(c?.name?.first_name), address: phone });
      }
      break;
    case 'button':
      text = str(m?.button?.text) ?? str(m?.button?.payload);
      break;
    case 'interactive':
      text = str(m?.interactive?.button_reply?.title) ?? str(m?.interactive?.list_reply?.title);
      break;
    default:
      attachments.push({ kind: 'UNSUPPORTED', name: type || null });
  }
  return {
    type: 'message',
    ...base,
    externalId: id,
    echo: false,
    text,
    sentAt,
    attachments,
    replyToExternalId: str(m?.context?.id),
    contactName: names.get(from) ?? null,
    contactPhone: from,
  };
}
