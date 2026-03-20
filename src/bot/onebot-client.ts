import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface OneBotMessage {
  post_type: string;
  message_type?: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  message_id?: number;
  message?: string | OneBotMessageSegment[];
  raw_message?: string;
  sender?: {
    user_id?: number;
    nickname?: string;
    card?: string;
    role?: string;
  };
  time?: number;
  self_id?: number;
}

export interface OneBotMessageSegment {
  type: string;
  data: Record<string, string>;
}

export class OneBotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private token: string;
  private reconnectInterval = 5000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;

  constructor(wsUrl: string, token: string = '') {
    super();
    this.wsUrl = wsUrl;
    this.token = token;
  }

  connect(): void {
    this.isClosing = false;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      this.ws = new WebSocket(this.wsUrl, { headers });
    } catch (err) {
      logger.error('Bot', `Failed to create WebSocket: ${err}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('Bot', `Connected to OneBot at ${this.wsUrl}`);
      this.emit('connected');
      this.startHeartbeat();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as OneBotMessage;
        this.handleEvent(event);
      } catch (err) {
        logger.error('Bot', `Failed to parse message: ${data.toString().slice(0, 200)}`);
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn('Bot', `WebSocket closed: ${code} ${reason.toString()}`);
      this.stopHeartbeat();
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      logger.error('Bot', `WebSocket error`, err);
    });
  }

  private handleEvent(event: OneBotMessage): void {
    if (event.post_type === 'meta_event') {
      return; // ignore heartbeat/lifecycle meta events
    }

    if (event.post_type === 'message' && event.message_type === 'group') {
      this.emit('group_message', event);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isClosing) return;
    logger.info('Bot', `Reconnecting in ${this.reconnectInterval / 1000}s...`);
    setTimeout(() => {
      if (!this.isClosing) {
        this.connect();
      }
    }, this.reconnectInterval);
  }

  disconnect(): void {
    this.isClosing = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Extract plain text from OneBot message (handles CQ codes and segment arrays)
 */
export function extractPlainText(message: string | OneBotMessageSegment[] | undefined): string {
  if (!message) return '';

  if (typeof message === 'string') {
    // Remove CQ codes, keep text
    return message
      .replace(/\[CQ:[^\]]+\]/g, '')
      .trim();
  }

  // Message segment array
  return message
    .filter(seg => seg.type === 'text')
    .map(seg => seg.data.text || '')
    .join('')
    .trim();
}

/**
 * Get display name from sender (card > nickname)
 */
export function getSenderName(sender?: OneBotMessage['sender']): string {
  if (!sender) return '未知用户';
  return sender.card || sender.nickname || String(sender.user_id) || '未知用户';
}
