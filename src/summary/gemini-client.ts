import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { logger } from '../utils/logger';
import { DailySummary, ChatStats, UserRanking, RoastResult, TopicBreakdown } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, ROAST_SYSTEM_PROMPT, buildRoastUserPrompt, BREAKDOWN_SYSTEM_PROMPT, buildBreakdownUserPrompt, formatMessagesForPrompt } from './prompt';
import { Message } from '../db/database';

export class SummaryGenerator {
  private genAI: GoogleGenerativeAI;
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
    this.genAI = new GoogleGenerativeAI(options.geminiApiKey);
    this.geminiModel = options.geminiModel;
    this.llmApiKey = options.llmApiKey || '';
    this.llmBaseUrl = options.llmBaseUrl || '';
    this.llmModel = options.llmModel || '';
  }

  async generateSummary(messages: Message[], date: string, groupName: string): Promise<DailySummary> {
    const stats = this.computeStats(messages);
    const ranking = this.computeRanking(messages);

    if (messages.length === 0) {
      return this.emptySummary(date, groupName);
    }

    const formattedMessages = formatMessagesForPrompt(messages);
    const userPrompt = buildUserPrompt(formattedMessages, date, groupName);

    const rawJson = await this.callLLMWithRetry('Summary', userPrompt, SYSTEM_PROMPT);

    if (!rawJson) {
      logger.error('Summary', 'All LLM attempts failed, returning stats-only summary');
      return {
        date,
        group_name: groupName,
        stats,
        topics: [{ title: 'AI总结生成失败', summary: '请查看日志排查问题', participants: [] }],
        highlights: [],
        ranking,
      };
    }

    try {
      const parsed = this.parseAndValidate(rawJson);
      return {
        date,
        group_name: groupName,
        stats,
        ranking,
        topics: parsed.topics,
        highlights: parsed.highlights,
      };
    } catch (err) {
      logger.error('Summary', 'Failed to parse LLM output', err);
      return {
        date,
        group_name: groupName,
        stats,
        topics: [{ title: 'AI总结生成失败', summary: '解析输出时出错', participants: [] }],
        highlights: [],
        ranking,
      };
    }
  }

  private async callGemini(
    userPrompt: string,
    systemPrompt: string,
    options?: { temperature?: number; maxOutputTokens?: number; responseMimeType?: string }
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxOutputTokens ?? 4096,
        ...(options?.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      },
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'model', parts: [{ text: systemPrompt }] },
    });

    return result.response.text();
  }

  private async callDeepSeek(
    userPrompt: string,
    systemPrompt: string,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const response = await axios.post(
      `${this.llmBaseUrl}/chat/completions`,
      {
        model: this.llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 4096,
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

  private async callLLMWithRetry(
    label: string,
    userPrompt: string,
    systemPrompt: string,
    geminiOpts?: { temperature?: number; maxOutputTokens?: number; responseMimeType?: string },
    deepseekOpts?: { temperature?: number; maxTokens?: number }
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logger.info(label, `Gemini attempt ${attempt + 1}/3`);
        return await this.callGemini(userPrompt, systemPrompt, geminiOpts);
      } catch (err) {
        logger.error(label, `Gemini attempt ${attempt + 1} failed`, err);
        if (attempt === 2 && this.llmApiKey) {
          logger.info(label, 'Falling back to DeepSeek');
          try {
            return await this.callDeepSeek(userPrompt, systemPrompt, deepseekOpts);
          } catch (fallbackErr) {
            logger.error(label, 'DeepSeek fallback also failed', fallbackErr);
          }
        }
      }
    }
    return null;
  }

  private stripCodeBlock(raw: string): string {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    return cleaned.trim();
  }

  private parseAndValidate(raw: string): { topics: DailySummary['topics']; highlights: DailySummary['highlights'] } {
    const parsed = JSON.parse(this.stripCodeBlock(raw));

    if (!parsed.topics) {
      throw new Error('Missing required field "topics" in LLM output');
    }

    return {
      topics: parsed.topics || [],
      highlights: parsed.highlights || [],
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

    const rawJson = await this.callLLMWithRetry(
      'Roast', userPrompt, ROAST_SYSTEM_PROMPT,
      { temperature: 0.8, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      { temperature: 0.8 }
    );

    if (!rawJson) {
      logger.error('Roast', 'All LLM attempts failed');
      return emptyResult;
    }

    try {
      const parsed = JSON.parse(this.stripCodeBlock(rawJson));
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
    if (messages.length === 0) {
      return { message_count: 0, user_count: 0, active_hours: '' };
    }

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

  private computeRanking(messages: Message[]): UserRanking[] {
    const userCounts = new Map<string, { nickname: string; count: number }>();
    for (const msg of messages) {
      const existing = userCounts.get(msg.user_id);
      if (existing) {
        existing.count++;
        // Use the latest nickname
        existing.nickname = msg.nickname;
      } else {
        userCounts.set(msg.user_id, { nickname: msg.nickname, count: 1 });
      }
    }
    return Array.from(userCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(u => ({ user: u.nickname, count: u.count }));
  }

  async generateBreakdown(messages: Message[], date: string, groupName: string): Promise<TopicBreakdown> {
    const emptyResult: TopicBreakdown = {
      group_name: groupName,
      date_range: date,
      overall_score: 0,
      categories: [],
      overall_comment_title: '',
      overall_comment: '',
    };

    if (messages.length === 0) return emptyResult;

    const formattedMessages = formatMessagesForPrompt(messages);
    const userPrompt = buildBreakdownUserPrompt(formattedMessages, date, groupName);

    const rawJson = await this.callLLMWithRetry(
      'Breakdown', userPrompt, BREAKDOWN_SYSTEM_PROMPT,
      { temperature: 0.5, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      { temperature: 0.5 }
    );

    if (!rawJson) {
      logger.error('Breakdown', 'All LLM attempts failed');
      return emptyResult;
    }

    try {
      const parsed = JSON.parse(this.stripCodeBlock(rawJson));
      return {
        group_name: groupName,
        date_range: date,
        overall_score: parsed.overall_score || 0,
        categories: parsed.categories || [],
        overall_comment_title: parsed.overall_comment_title || '',
        overall_comment: parsed.overall_comment || '',
      };
    } catch (err) {
      logger.error('Breakdown', 'Failed to parse breakdown output', err);
      return emptyResult;
    }
  }

  private emptySummary(date: string, groupName: string): DailySummary {
    return {
      date,
      group_name: groupName,
      stats: { message_count: 0, user_count: 0, active_hours: '' },
      topics: [],
      highlights: [],
      ranking: [],
    };
  }
}
