import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { UPLOADS_ROOT } from '../../files/storage.service';
import { INCOMING_FILE_LIMIT } from './meta.config';

/** Файлы переписок — в подпапке: уборка «файлов-сирот» смотрит только верхний уровень uploads. */
export const CHAT_DIR = path.join(UPLOADS_ROOT, 'chat');

/** Скачиваем только с серверов Meta (инструкция, шаг 5). Чужая ссылка в уведомлении не должна вести внутрь нашей сети. */
const META_HOSTS = ['fbcdn.net', 'fbsbx.com', 'cdninstagram.com', 'instagram.com', 'facebook.com', 'whatsapp.net'];
export const isMetaHost = (host: string) => META_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
};

export type SniffedType = 'jpg' | 'png' | 'pdf' | 'webm' | 'ogg' | 'mp4' | 'wav' | null;

/** Тип файла по первым байтам, а не по расширению (инструкция, шаг 6). */
export function sniff(buf: Buffer): SniffedType {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  return null;
}

let ffmpegPath: string | null | undefined;
function ffmpegBinary(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    ffmpegPath = p && fs.existsSync(p) ? p : null;
  } catch {
    ffmpegPath = null;
  }
  return ffmpegPath;
}

@Injectable()
export class MetaMediaService {
  private readonly logger = new Logger(MetaMediaService.name);

  ffmpegAvailable(): boolean {
    return !!ffmpegBinary();
  }

  async ensureDir() {
    await fs.promises.mkdir(CHAT_DIR, { recursive: true });
  }

  /** Сохранить буфер под случайным именем. Возвращает имя файла в uploads/chat. */
  async save(buf: Buffer, ext: string): Promise<string> {
    await this.ensureDir();
    const name = `${randomUUID()}${ext.startsWith('.') ? ext : `.${ext}`}`;
    await fs.promises.writeFile(path.join(CHAT_DIR, name), buf);
    return name;
  }

  filePath(name: string): string {
    // Только имя из нашей папки — никаких путей.
    return path.join(CHAT_DIR, path.basename(name));
  }

  extFor(mime: string | null | undefined, fallbackName?: string | null): string {
    const m = (mime ?? '').split(';')[0].trim().toLowerCase();
    if (EXT_BY_MIME[m]) return EXT_BY_MIME[m];
    const fromName = fallbackName ? path.extname(fallbackName).toLowerCase() : '';
    return /^\.[a-z0-9]{1,5}$/.test(fromName) ? fromName : '.bin';
  }

  /**
   * Скачать файл с сервера Meta: только HTTPS, только хосты Meta, переадресации
   * вручную с той же проверкой, не больше 30 МБ. token — для WhatsApp: его
   * файлы отдаются только с ключом в заголовке.
   */
  async download(url: string, token?: string): Promise<{ buf: Buffer; mime: string | null }> {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || !isMetaHost(u.hostname)) {
        throw new Error(`Файл не с сервера Meta: ${u.hostname}`);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(current, {
          redirect: 'manual',
          headers: token ? { Authorization: `Bearer ${token}`, 'User-Agent': 'GrantChinaCRM/1.0' } : { 'User-Agent': 'GrantChinaCRM/1.0' },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('Переадресация без адреса');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > INCOMING_FILE_LIMIT) throw new Error('Файл больше 30 МБ');
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Пустой ответ');
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > INCOMING_FILE_LIMIT) {
          await reader.cancel().catch(() => undefined);
          throw new Error('Файл больше 30 МБ');
        }
        chunks.push(Buffer.from(value));
      }
      return { buf: Buffer.concat(chunks), mime: res.headers.get('content-type') };
    }
    throw new Error('Слишком много переадресаций');
  }

  /**
   * ffmpeg: input → output. Для CRM и Instagram — AAC (.m4a), играет везде,
   * включая iPhone; для WhatsApp — Ogg/Opus: только так он показывает
   * голосовое, а не файл. -t 300 — не длиннее 5 минут.
   */
  async convert(inputName: string, target: 'm4a' | 'ogg'): Promise<{ name: string; size: number } | null> {
    const bin = ffmpegBinary();
    if (!bin) {
      this.logger.warn('ffmpeg недоступен — голосовое без перекодирования');
      return null;
    }
    const outName = `${randomUUID()}.${target}`;
    const args =
      target === 'm4a'
        ? ['-y', '-i', this.filePath(inputName), '-t', '300', '-vn', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', this.filePath(outName)]
        : ['-y', '-i', this.filePath(inputName), '-t', '300', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-application', 'voip', this.filePath(outName)];
    await new Promise<void>((resolve, reject) => {
      execFile(bin, args, { timeout: 120_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
    const st = await fs.promises.stat(this.filePath(outName));
    return { name: outName, size: st.size };
  }

  /** Длительность аудио в секундах по ffmpeg (для предела 5 минут). null — не удалось узнать. */
  async durationSeconds(name: string): Promise<number | null> {
    const bin = ffmpegBinary();
    if (!bin) return null;
    return new Promise((resolve) => {
      execFile(bin, ['-i', this.filePath(name), '-f', 'null', '-'], { timeout: 60_000, windowsHide: true }, (_err, _out, stderr) => {
        const all = [...String(stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
        const last = all[all.length - 1];
        if (!last) return resolve(null);
        resolve(Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]));
      });
    });
  }
}
