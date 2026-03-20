import cron from 'node-cron';
import axios from 'axios';
import { SummaryGenerator } from '../summary/gemini-client';
import { CardRenderer } from '../render/card-renderer';
import { OneBotSender } from '../sender/onebot-sender';
import { Message } from '../db/database';
import { logger } from '../utils/logger';

export interface SchedulerOptions {
  groupId: string;
  groupName: string;
  onebotHttpUrl: string;
  onebotToken: string;
  summaryGenerator: SummaryGenerator;
  cardRenderer: CardRenderer;
  sender: OneBotSender;
  sendMode: 'group' | 'private';
  botQq: string;
}

interface RawMsg {
  time: number;
  sender: { user_id: number; nickname: string; card?: string };
  raw_message: string;
  message_id: number;
  group_id: number;
}

export class SummaryScheduler {
  private options: SchedulerOptions;
  private tasks: cron.ScheduledTask[] = [];

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  /**
   * Start three cron jobs:
   *   07:30 — summarize late night (22:30 yesterday → 07:30 today)
   *   17:30 — summarize daytime    (07:30 today     → 17:30 today)
   *   22:30 — summarize evening    (17:30 today     → 22:30 today)
   */
  start(): void {
    // Morning summary at 07:30 (covers late night)
    this.tasks.push(
      cron.schedule('30 7 * * *', async () => {
        logger.info('Scheduler', '=== Late-night summary triggered ===');
        try {
          await this.runHalfDayPipeline('night');
        } catch (err) {
          logger.error('Scheduler', 'Night pipeline failed', err);
        }
      })
    );

    // Afternoon summary at 17:30 (covers daytime)
    this.tasks.push(
      cron.schedule('30 17 * * *', async () => {
        logger.info('Scheduler', '=== Daytime summary triggered ===');
        try {
          await this.runHalfDayPipeline('daytime');
        } catch (err) {
          logger.error('Scheduler', 'Daytime pipeline failed', err);
        }
      })
    );

    // Night summary at 22:30 (covers evening)
    this.tasks.push(
      cron.schedule('30 22 * * *', async () => {
        logger.info('Scheduler', '=== Evening summary triggered ===');
        try {
          await this.runHalfDayPipeline('evening');
        } catch (err) {
          logger.error('Scheduler', 'Evening pipeline failed', err);
        }
      })
    );

    logger.info('Scheduler', 'Scheduled: 07:30 (night) + 17:30 (daytime) + 22:30 (evening)');
  }

  stop(): void {
    this.tasks.forEach(t => t.stop());
    this.tasks = [];
  }

  /**
   * Run the summary pipeline for a half-day window.
   * Can also be called manually for testing.
   */
  async runHalfDayPipeline(
    period: 'night' | 'daytime' | 'evening',
    overrideStart?: Date,
    overrideEnd?: Date
  ): Promise<string[]> {
    const { groupId, groupName, summaryGenerator, cardRenderer, sender, sendMode, botQq } = this.options;
    const now = new Date();

    let windowStart: Date;
    let windowEnd: Date;
    let label: string;

    if (overrideStart && overrideEnd) {
      windowStart = overrideStart;
      windowEnd = overrideEnd;
      label = '自定义时段';
    } else if (period === 'night') {
      // 22:30 yesterday → 07:30 today
      windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 22, 30, 0);
      windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30, 0);
      label = '深夜总结';
    } else if (period === 'daytime') {
      // 07:30 today → 17:30 today
      windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30, 0);
      windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 30, 0);
      label = '白天总结';
    } else {
      // 17:30 today → 22:30 today
      windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 30, 0);
      windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 30, 0);
      label = '晚间总结';
    }

    const startTs = Math.floor(windowStart.getTime() / 1000);
    const endTs = Math.floor(windowEnd.getTime() / 1000);
    const dateStr = formatDate(now);
    const timeRange = `${formatTime(windowStart)}-${formatTime(windowEnd)}`;

    logger.info('Scheduler', `${label}: ${timeRange}`);

    // Step 1: Fetch messages from OneBot history API
    logger.info('Scheduler', 'Fetching group message history...');
    const rawMsgs = await this.fetchHistory(groupId, startTs, endTs);
    logger.info('Scheduler', `Got ${rawMsgs.length} messages in window`);

    if (rawMsgs.length === 0) {
      logger.info('Scheduler', 'No messages in time window, skipping');
      return [];
    }

    const messages: Message[] = rawMsgs.map(m => ({
      group_id: String(m.group_id),
      user_id: String(m.sender.user_id),
      nickname: m.sender.card || m.sender.nickname || String(m.sender.user_id),
      content: m.raw_message,
      message_id: String(m.message_id),
      timestamp: m.time,
    }));

    // Step 2: Generate summary + roast in parallel
    logger.info('Scheduler', 'Generating AI summary and roast...');
    const [summary, roast] = await Promise.all([
      summaryGenerator.generateSummary(messages, `${dateStr} ${label}`, groupName),
      summaryGenerator.generateRoast(messages, `${dateStr} ${timeRange}`, groupName),
    ]);

    // Step 3: Render card images + roast card
    logger.info('Scheduler', 'Rendering cards...');
    summary.date = `${dateStr} · ${label} (${timeRange})`;
    const imagePaths = await cardRenderer.render(summary);

    if (roast.items.length > 0) {
      logger.info('Scheduler', 'Rendering roast card...');
      const roastPath = await cardRenderer.renderRoast(roast);
      imagePaths.push(roastPath);
    }

    // Step 4: Send
    let success: boolean;
    if (sendMode === 'private' && botQq) {
      logger.info('Scheduler', `Sending to private QQ ${botQq}`);
      success = await sender.sendPrivateImages(botQq, imagePaths);
    } else {
      logger.info('Scheduler', `Sending to group ${groupId}`);
      success = await sender.sendImages(groupId, imagePaths);
    }

    if (!success) {
      logger.warn('Scheduler', 'Image send failed');
    }

    logger.info('Scheduler', 'Pipeline complete');
    return imagePaths;
  }

  private async fetchHistory(groupId: string, startTs: number, endTs: number): Promise<RawMsg[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.onebotToken) {
      headers['Authorization'] = `Bearer ${this.options.onebotToken}`;
    }

    const seen = new Set<number>();
    const result: RawMsg[] = [];
    const BATCH_SIZE = 2000;
    const MAX_PAGES = 5;

    const addToResult = (msgs: RawMsg[]) => {
      for (const m of msgs) {
        if (m.time < startTs || m.time > endTs) continue;
        if (seen.has(m.message_id)) continue;
        seen.add(m.message_id);
        result.push(m);
      }
    };

    // First fetch: latest messages (no message_seq)
    const resp = await axios.post(
      `${this.options.onebotHttpUrl}/get_group_msg_history`,
      { group_id: Number(groupId), count: BATCH_SIZE },
      { headers, timeout: 60000 }
    );

    if (resp.data?.retcode !== 0) {
      logger.error('Scheduler', `History API error: ${JSON.stringify(resp.data)}`);
      return [];
    }

    const firstBatch: RawMsg[] = resp.data.data?.messages || [];
    addToResult(firstBatch);
    logger.info('Scheduler', `Batch 1: fetched ${firstBatch.length} total, ${result.length} in window`);

    // Check if we need to go further back
    if (firstBatch.length > 0) {
      const earliest = firstBatch.reduce((a, b) => (a.time < b.time ? a : b));

      if (earliest.time > startTs) {
        // Still haven't reached window start — paginate backwards using reverseOrder
        let curSeq = earliest.message_id;

        for (let page = 0; page < MAX_PAGES; page++) {
          const pageResp = await axios.post(
            `${this.options.onebotHttpUrl}/get_group_msg_history`,
            { group_id: Number(groupId), count: BATCH_SIZE, message_seq: curSeq, reverseOrder: true },
            { headers, timeout: 60000 }
          );

          if (pageResp.data?.retcode !== 0) break;

          const msgs: RawMsg[] = pageResp.data.data?.messages || [];
          if (msgs.length === 0) break;

          const prevCount = result.length;
          addToResult(msgs);
          logger.info('Scheduler', `Batch ${page + 2} (reverse): fetched ${msgs.length}, added ${result.length - prevCount} in window`);

          // Check if we've reached before window start
          const batchEarliest = msgs.reduce((a, b) => (a.time < b.time ? a : b));
          if (batchEarliest.time <= startTs) break;

          // Continue from the earliest in this batch
          curSeq = batchEarliest.message_id;
        }
      }
    }

    return result.sort((a, b) => a.time - b.time);
  }
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
