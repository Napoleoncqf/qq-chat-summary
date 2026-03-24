import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  // OneBot
  onebotWsUrl: process.env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001',
  onebotHttpUrl: process.env.ONEBOT_HTTP_URL || 'http://127.0.0.1:3000',
  onebotToken: process.env.ONEBOT_TOKEN || '',

  // Target groups: "id", "id:group", or "id:group:daily" (comma-separated)
  // sendMode: "private" (default) or "group"
  // schedule: "3x" (default, 3 times/day) or "daily" (once at 17:30, previous day)
  targetGroups: (process.env.TARGET_GROUP_IDS || process.env.TARGET_GROUP_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(entry => {
      const parts = entry.split(':');
      const groupId = parts[0].trim();
      const sendMode = (parts[1]?.trim() === 'group' ? 'group' : 'private') as 'group' | 'private';
      const schedule = (parts[2]?.trim() === 'daily' ? 'daily' : '3x') as 'daily' | '3x';
      return { groupId, sendMode, schedule };
    }),

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',

  // Backup LLM
  llmApiKey: process.env.LLM_API_KEY || '',
  llmBaseUrl: process.env.LLM_BASE_URL || '',
  llmModel: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-V3',

  // Paths
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/chat.db'),
  outputDir: process.env.OUTPUT_DIR || path.resolve(__dirname, '../../output'),
  templateDir: process.env.TEMPLATE_DIR || path.resolve(__dirname, '../../templates'),

  // Schedule
  cronSchedule: process.env.CRON_SCHEDULE || '0 22 * * *',

  // Group name (for card title)
  groupName: process.env.GROUP_NAME || 'QQ群聊',

  botQq: process.env.BOT_QQ || '',
};
