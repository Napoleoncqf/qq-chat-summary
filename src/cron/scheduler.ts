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

interface RawMsgSegment {
  type: string;
  data: Record<string, any>;
}

interface RawMsg {
  time: number;
  sender: { user_id: number; nickname: string; card?: string };
  raw_message: string;
  message_id: number;
  group_id: number;
  message?: RawMsgSegment[];
}

export class SummaryScheduler {
  private options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  /**
   * Run the summary pipeline for a half-day window.
   * Can also be called manually for testing.
   */
  async runHalfDayPipeline(
    period: 'night' | 'daytime' | 'evening' | 'daily',
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
    } else if (period === 'daily') {
      // Full previous day: 00:00 yesterday → 23:59:59 yesterday
      windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      label = '每日总结';
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
    const dateStr = period === 'daily' ? formatDate(windowStart) : formatDate(now);
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

    // Step 1.5: Expand forwarded messages
    await this.expandForwardMessages(rawMsgs);

    const messages: Message[] = rawMsgs.map(m => ({
      group_id: String(m.group_id),
      user_id: String(m.sender.user_id),
      nickname: m.sender.card || m.sender.nickname || String(m.sender.user_id),
      content: m.raw_message,
      message_id: String(m.message_id),
      timestamp: m.time,
    }));

    // Step 2: Generate summary + roast + breakdown in parallel
    logger.info('Scheduler', 'Generating AI summary, roast, and breakdown...');
    const [summary, roast, breakdown] = await Promise.all([
      summaryGenerator.generateSummary(messages, `${dateStr} ${label}`, groupName),
      summaryGenerator.generateRoast(messages, `${dateStr} ${timeRange}`, groupName),
      summaryGenerator.generateBreakdown(messages, `${dateStr} ${label}`, groupName),
    ]);

    // Step 3: Render card images
    const theme = period === 'evening' ? 'dark' : 'light';
    logger.info('Scheduler', `Rendering cards (${theme} theme)...`);
    summary.date = period === 'daily'
      ? `${dateStr} · ${label}`
      : `${dateStr} · ${label} (${timeRange})`;
    const imagePaths = await cardRenderer.render(summary, theme);

    // Add breakdown card
    if (breakdown.categories.length > 0) {
      logger.info('Scheduler', 'Rendering breakdown card...');
      const breakdownPath = await cardRenderer.renderBreakdown(breakdown, theme);
      imagePaths.push(breakdownPath);
    }

    // Add roast card
    if (roast.items.length > 0) {
      logger.info('Scheduler', 'Rendering roast card...');
      const roastPath = await cardRenderer.renderRoast(roast, theme);
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

  /**
   * Expand forwarded messages using inline segment data (preferred) or get_forward_msg API (fallback).
   * Depth=1 only (nested forwards are marked as skipped).
   */
  private async expandForwardMessages(rawMsgs: RawMsg[]): Promise<void> {
    const FORWARD_CQ_REGEX = /\[CQ:forward,[^\]]*\]/g;
    const MAX_SUB_MESSAGES = 20;
    const MAX_CHAR_PER_MSG = 500;

    let expandedCount = 0;
    let failedCount = 0;

    for (const msg of rawMsgs) {
      // Method 1: Check message segments for forward type (NapCat inlines content)
      const forwardSeg = msg.message?.find(s => s.type === 'forward');
      if (!forwardSeg && !FORWARD_CQ_REGEX.test(msg.raw_message)) continue;
      // Reset regex lastIndex after test()
      FORWARD_CQ_REGEX.lastIndex = 0;

      let subMessages: Array<{
        sender?: { user_id?: number; nickname?: string; card?: string };
        raw_message?: string;
      }> | null = null;

      // Try inline content first (zero API calls)
      if (forwardSeg?.data?.content && Array.isArray(forwardSeg.data.content)) {
        subMessages = forwardSeg.data.content;
      }

      // Fallback: call get_forward_msg API
      if (!subMessages) {
        const idMatch = msg.raw_message.match(/\[CQ:forward,[^\]]*?id=([^,\]]+)/);
        if (idMatch) {
          subMessages = await this.fetchForwardContent(idMatch[1]);
        }
      }

      if (!subMessages || subMessages.length === 0) {
        msg.raw_message = msg.raw_message.replace(FORWARD_CQ_REGEX, '[转发消息，无法展开]');
        failedCount++;
        continue;
      }

      // Format sub-messages
      const expandedParts: string[] = [];
      const capped = subMessages.slice(0, MAX_SUB_MESSAGES);

      for (const sub of capped) {
        const name = sub.sender?.card || sub.sender?.nickname || String(sub.sender?.user_id || '未知');
        let content = sub.raw_message || '';

        // Depth=1: replace nested forwards
        content = content.replace(/\[CQ:forward,[^\]]*\]/g, '[嵌套转发，已略]');
        // Strip media CQ codes, keep text
        content = content.replace(/\[CQ:[^\]]+\]/g, '').trim();
        // Truncate
        if (content.length > MAX_CHAR_PER_MSG) {
          content = content.slice(0, MAX_CHAR_PER_MSG) + '…';
        }

        if (content) {
          expandedParts.push(`【转发·${name}】${content}`);
        }
      }

      if (expandedParts.length > 0) {
        let expanded = expandedParts.join('\n');
        if (subMessages.length > MAX_SUB_MESSAGES) {
          expanded += `\n[…共${subMessages.length}条转发，已展示前${MAX_SUB_MESSAGES}条]`;
        }
        msg.raw_message = msg.raw_message.replace(FORWARD_CQ_REGEX, expanded);
        expandedCount++;
      } else {
        msg.raw_message = msg.raw_message.replace(FORWARD_CQ_REGEX, '[转发消息，内容为纯媒体]');
      }
    }

    if (expandedCount > 0 || failedCount > 0) {
      logger.info('Scheduler', `转发消息展开: ${expandedCount} 成功, ${failedCount} 失败`);
    }
  }

  /** Fallback: fetch forward content via API when segment data is missing */
  private async fetchForwardContent(forwardId: string): Promise<Array<{
    sender?: { user_id?: number; nickname?: string; card?: string };
    raw_message?: string;
  }> | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.onebotToken) {
      headers['Authorization'] = `Bearer ${this.options.onebotToken}`;
    }

    // Try both param names for compatibility
    for (const body of [{ id: forwardId }, { message_id: forwardId }]) {
      try {
        const resp = await axios.post(
          `${this.options.onebotHttpUrl}/get_forward_msg`,
          body,
          { headers, timeout: 5000 }
        );
        if (resp.data?.retcode === 0 && resp.data.data?.messages) {
          return resp.data.data.messages;
        }
      } catch (err: any) {
        const errMsg = err.code === 'ECONNABORTED' ? '超时' : (err.message || String(err));
        logger.warn('Scheduler', `get_forward_msg fallback failed (id=${forwardId}): ${errMsg}`);
      }
    }
    return null;
  }

  private async fetchHistory(groupId: string, startTs: number, endTs: number): Promise<RawMsg[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.onebotToken) {
      headers['Authorization'] = `Bearer ${this.options.onebotToken}`;
    }

    const seen = new Set<number>();
    const result: RawMsg[] = [];
    const MAX_PAGES = 5;
    const TIMEOUT = 120000;

    const addToResult = (msgs: RawMsg[]) => {
      for (const m of msgs) {
        if (m.time < startTs || m.time > endTs) continue;
        if (seen.has(m.message_id)) continue;
        seen.add(m.message_id);
        result.push(m);
      }
    };

    // Try fetching with decreasing batch sizes on timeout
    const batchSizes = [500, 200, 100];
    let firstBatch: RawMsg[] | null = null;

    for (const count of batchSizes) {
      try {
        logger.info('Scheduler', `Fetching history (group ${groupId}, count=${count}, timeout=${TIMEOUT}ms)...`);
        const resp = await axios.post(
          `${this.options.onebotHttpUrl}/get_group_msg_history`,
          { group_id: Number(groupId), count },
          { headers, timeout: TIMEOUT }
        );

        if (resp.data?.retcode !== 0) {
          logger.error('Scheduler', `History API error (group ${groupId}): retcode=${resp.data?.retcode}, msg=${resp.data?.message || 'unknown'}`);
          return [];
        }

        firstBatch = resp.data.data?.messages || [];
        break;
      } catch (err: any) {
        const errMsg = err.code === 'ECONNABORTED' ? `timeout after ${TIMEOUT}ms` : (err.message || String(err));
        logger.warn('Scheduler', `Fetch failed (group ${groupId}, count=${count}): ${errMsg}`);
        if (err.code !== 'ECONNABORTED') {
          // Non-timeout error, no point retrying with smaller batch
          logger.error('Scheduler', `Non-timeout error for group ${groupId}, giving up`);
          return [];
        }
      }
    }

    if (!firstBatch) {
      logger.error('Scheduler', `All fetch attempts timed out for group ${groupId}`);
      return [];
    }

    addToResult(firstBatch);
    logger.info('Scheduler', `Batch 1: fetched ${firstBatch.length} total, ${result.length} in window`);

    // Check if we need to go further back
    if (firstBatch.length > 0) {
      const earliest = firstBatch.reduce((a, b) => (a.time < b.time ? a : b));

      if (earliest.time > startTs) {
        // Still haven't reached window start — paginate backwards using reverseOrder
        let curSeq = earliest.message_id;

        for (let page = 0; page < MAX_PAGES; page++) {
          try {
            const pageResp = await axios.post(
              `${this.options.onebotHttpUrl}/get_group_msg_history`,
              { group_id: Number(groupId), count: 500, message_seq: curSeq, reverseOrder: true },
              { headers, timeout: TIMEOUT }
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

            curSeq = batchEarliest.message_id;
          } catch (err: any) {
            const errMsg = err.code === 'ECONNABORTED' ? 'timeout' : (err.message || String(err));
            logger.warn('Scheduler', `Pagination batch ${page + 2} failed (group ${groupId}): ${errMsg}`);
            break;
          }
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
