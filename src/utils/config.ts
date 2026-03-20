import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  // OneBot
  onebotWsUrl: process.env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001',
  onebotHttpUrl: process.env.ONEBOT_HTTP_URL || 'http://127.0.0.1:3000',
  onebotToken: process.env.ONEBOT_TOKEN || '',

  // Target groups: "id" or "id:group" (comma-separated)
  // e.g. "123,456:group" → 123 sends private, 456 sends to group
  targetGroups: (process.env.TARGET_GROUP_IDS || process.env.TARGET_GROUP_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(entry => {
      const [id, mode] = entry.split(':');
      return { groupId: id.trim(), sendMode: (mode?.trim() === 'group' ? 'group' : 'private') as 'group' | 'private' };
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
