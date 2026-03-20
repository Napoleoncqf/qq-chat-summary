import { OneBotClient, OneBotMessage, extractPlainText, getSenderName } from './onebot-client';
import { ChatDatabase, Message } from '../db/database';
import { logger } from '../utils/logger';

export class MessageCollector {
  private client: OneBotClient;
  private db: ChatDatabase;
  private targetGroupIds: Set<string>;
  private messageCount = 0;

  constructor(client: OneBotClient, db: ChatDatabase, targetGroupIds: string[]) {
    this.client = client;
    this.db = db;
    this.targetGroupIds = new Set(targetGroupIds);
  }

  start(): void {
    this.client.on('group_message', (event: OneBotMessage) => {
      this.handleGroupMessage(event);
    });
    logger.info('Collector', `Listening for groups: ${Array.from(this.targetGroupIds).join(', ')}`);
  }

  private handleGroupMessage(event: OneBotMessage): void {
    const groupId = String(event.group_id || '');

    // If targetGroupIds is empty, collect all groups; otherwise filter
    if (this.targetGroupIds.size > 0 && !this.targetGroupIds.has(groupId)) {
      return;
    }

    const content = event.raw_message || extractPlainText(event.message);
    if (!content) return; // skip empty messages

    const msg: Message = {
      group_id: groupId,
      user_id: String(event.user_id || ''),
      nickname: getSenderName(event.sender),
      content,
      message_id: String(event.message_id || ''),
      timestamp: event.time || Math.floor(Date.now() / 1000),
    };

    try {
      this.db.insertMessage(msg);
      this.messageCount++;
      if (this.messageCount % 100 === 0) {
        logger.info('Collector', `Stored ${this.messageCount} messages total`);
      }
    } catch (err) {
      logger.error('Collector', `Failed to store message`, err);
    }
  }

  getMessageCount(): number {
    return this.messageCount;
  }
}
