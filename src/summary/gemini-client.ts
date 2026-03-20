import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { logger } from '../utils/logger';
import { DailySummary, ChatStats, RoastResult } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, ROAST_SYSTEM_PROMPT, buildRoastUserPrompt, formatMessagesForPrompt } from './prompt';
import { Message } from '../db/database';

export class SummaryGenerator {
  private geminiApiKey: string;
  private geminiModel: string;
  private llmApiKey: string;
  private llmBaseUrl: string;
  private llmModel: string;

  constructor(options: {
    geminiApiKey: string;
    geminiModel: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmModel?: string;
  }) {
    this.geminiApiKey = options.geminiApiKey;
    this.geminiModel = options.geminiModel;
    this.llmApiKey = options.llmApiKey || '';
    this.llmBaseUrl = options.llmBaseUrl || '';
    this.llmModel = options.llmModel || '';
  }

  async generateSummary(messages: Message[], date: string, groupName: string): Promise<DailySummary> {
    if (messages.length === 0) {
      return this.emptySummary(date, groupName);
    }

    const formattedMessages = formatMessagesForPrompt(messages);
    const userPrompt = buildUserPrompt(formattedMessages, date, groupName);
    const stats = this.computeStats(messages);

    // Try Gemini first, fallback to DeepSeek
    let rawJson: string | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logger.info('Summary', `Gemini attempt ${attempt + 1}/3`);
        rawJson = await this.callGemini(userPrompt);
        break;
      } catch (err) {
        logger.error('Summary', `Gemini attempt ${attempt + 1} failed`, err);
        if (attempt === 2 && this.llmApiKey) {
          logger.info('Summary', 'Falling back to DeepSeek');
          try {
            rawJson = await this.callDeepSeek(userPrompt);
          } catch (fallbackErr) {
            logger.error('Summary', 'DeepSeek fallback also failed', fallbackErr);
          }
        }
      }
    }

    if (!rawJson) {
      logger.error('Summary', 'All LLM attempts failed, returning stats-only summary');
      return this.statsOnlySummary(date, groupName, stats, messages);
    }

    try {
      const parsed = this.parseAndValidate(rawJson);
      // Override stats with computed values (more accurate than LLM guesses)
      parsed.stats = stats;
      return {
        date,
        group_name: groupName,
        ...parsed,
      };
    } catch (err) {
      logger.error('Summary', 'Failed to parse LLM output', err);
      return this.statsOnlySummary(date, groupName, stats, messages);
    }
  }

  private async callGemini(userPrompt: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
    });

    const text = result.response.text();
    return text;
  }

  private async callDeepSeek(userPrompt: string): Promise<string> {
    const response = await axios.post(
      `${this.llmBaseUrl}/chat/completions`,
      {
        model: this.llmModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      },
      {
        headers: {
          'Authorization': `Bearer ${this.llmApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }
    );

    return response.data.choices[0].message.content;
  }

  private parseAndValidate(raw: string): Omit<DailySummary, 'date' | 'group_name'> {
    // Strip markdown code block markers if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    // Validate required fields exist
    if (!parsed.stats || !parsed.topics || !parsed.ranking) {
      throw new Error('Missing required fields in LLM output');
    }

    return {
      stats: parsed.stats,
      topics: parsed.topics || [],
      highlights: parsed.highlights || [],
      ranking: parsed.ranking || [],
      moderation: parsed.moderation || [],
      resources: parsed.resources || [],
    };
  }

  async generateRoast(messages: Message[], dateRange: string, groupName: string): Promise<RoastResult> {
    const stats = this.computeStats(messages);
    const emptyResult: RoastResult = {
      group_name: groupName,
      date_range: dateRange,
      message_count: stats.message_count,
      user_count: stats.user_count,
      items: [],
    };

    if (messages.length === 0) return emptyResult;

    const formattedMessages = formatMessagesForPrompt(messages);
    const userPrompt = buildRoastUserPrompt(formattedMessages, dateRange, groupName);

    let rawJson: string | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logger.info('Roast', `Gemini attempt ${attempt + 1}/3`);
        const genAI = new GoogleGenerativeAI(this.geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: this.geminiModel,
          generationConfig: { temperature: 0.8, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { role: 'model', parts: [{ text: ROAST_SYSTEM_PROMPT }] },
        });
        rawJson = result.response.text();
        break;
      } catch (err) {
        logger.error('Roast', `Gemini attempt ${attempt + 1} failed`, err);
        if (attempt === 2 && this.llmApiKey) {
          try {
            const response = await axios.post(
              `${this.llmBaseUrl}/chat/completions`,
              {
                model: this.llmModel,
                messages: [
                  { role: 'system', content: ROAST_SYSTEM_PROMPT },
                  { role: 'user', content: userPrompt },
                ],
                temperature: 0.8,
                max_tokens: 4096,
              },
              {
                headers: {
                  'Authorization': `Bearer ${this.llmApiKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 120000,
              }
            );
            rawJson = response.data.choices[0].message.content;
          } catch (fallbackErr) {
            logger.error('Roast', 'DeepSeek fallback also failed', fallbackErr);
          }
        }
      }
    }

    if (!rawJson) {
      logger.error('Roast', 'All LLM attempts failed');
      return emptyResult;
    }

    try {
      let cleaned = rawJson.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      return {
        group_name: groupName,
        date_range: dateRange,
        message_count: stats.message_count,
        user_count: stats.user_count,
        items: parsed.items || [],
      };
    } catch (err) {
      logger.error('Roast', 'Failed to parse roast output', err);
      return emptyResult;
    }
  }

  private computeStats(messages: Message[]): ChatStats {
    const users = new Set(messages.map(m => m.user_id));
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const first = new Date(sorted[0].timestamp * 1000);
    const last = new Date(sorted[sorted.length - 1].timestamp * 1000);

    const fmt = (d: Date) => {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    };

    return {
      message_count: messages.length,
      user_count: users.size,
      active_hours: `${fmt(first)}-${fmt(last)}`,
    };
  }

  private emptySummary(date: string, groupName: string): DailySummary {
    return {
      date,
      group_name: groupName,
      stats: { message_count: 0, user_count: 0, active_hours: '' },
      topics: [],
      highlights: [],
      ranking: [],
      moderation: [],
      resources: [],
    };
  }

  private statsOnlySummary(date: string, groupName: string, stats: ChatStats, messages: Message[]): DailySummary {
    // Generate basic ranking from raw data
    const userCounts = new Map<string, { nickname: string; count: number }>();
    for (const msg of messages) {
      const existing = userCounts.get(msg.user_id);
      if (existing) {
        existing.count++;
      } else {
        userCounts.set(msg.user_id, { nickname: msg.nickname, count: 1 });
      }
    }
    const ranking = Array.from(userCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(u => ({ user: u.nickname, count: u.count }));

    return {
      date,
      group_name: groupName,
      stats,
      topics: [{ title: 'AI总结生成失败', summary: '请查看日志排查问题', participants: [] }],
      highlights: [],
      ranking,
      moderation: [],
      resources: [],
    };
  }
}
