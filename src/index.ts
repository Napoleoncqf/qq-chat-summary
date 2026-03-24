import axios from 'axios';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { SummaryGenerator } from './summary/gemini-client';
import { CardRenderer } from './render/card-renderer';
import { OneBotSender } from './sender/onebot-sender';
import cron from 'node-cron';
import { SummaryScheduler } from './cron/scheduler';

function onebotHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.onebotToken) {
    headers['Authorization'] = `Bearer ${config.onebotToken}`;
  }
  return headers;
}

async function getLoginQQ(): Promise<string> {
  try {
    const resp = await axios.post(
      `${config.onebotHttpUrl}/get_login_info`,
      {},
      { headers: onebotHeaders(), timeout: 10000 }
    );
    if (resp.data?.retcode === 0 && resp.data.data?.user_id) {
      return String(resp.data.data.user_id);
    }
  } catch (err) {
    logger.warn('Main', 'Failed to get login info from OneBot');
  }
  return '';
}

async function getGroupName(groupId: string): Promise<string> {
  try {
    const resp = await axios.post(
      `${config.onebotHttpUrl}/get_group_info`,
      { group_id: Number(groupId) },
      { headers: onebotHeaders(), timeout: 10000 }
    );
    if (resp.data?.retcode === 0 && resp.data.data?.group_name) {
      return resp.data.data.group_name;
    }
  } catch (err) {
    logger.warn('Main', 'Failed to get group name from OneBot');
  }
  return '';
}

async function main() {
  logger.info('Main', '=== QQ Chat Summary Bot Starting ===');

  if (config.targetGroups.length === 0) {
    logger.error('Main', 'TARGET_GROUP_IDS (or TARGET_GROUP_ID) not set in .env');
    process.exit(1);
  }
  if (!config.geminiApiKey) {
    logger.error('Main', 'GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  // Auto-detect bot QQ if any group uses private mode
  const hasPrivate = config.targetGroups.some(g => g.sendMode === 'private');
  let botQq = config.botQq;
  if (!botQq && hasPrivate) {
    botQq = await getLoginQQ();
    if (botQq) {
      logger.info('Main', `Auto-detected bot QQ: ${botQq}`);
    } else {
      logger.error('Main', 'Some groups use private mode but BOT_QQ not set and auto-detect failed');
      process.exit(1);
    }
  }

  const summaryGenerator = new SummaryGenerator({
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    llmApiKey: config.llmApiKey,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
  });

  const cardRenderer = new CardRenderer(config.templateDir, config.outputDir);
  const sender = new OneBotSender(config.onebotHttpUrl, config.onebotToken);

  // Build scheduler instances (without starting their own crons)
  const schedulerConfigs: Array<{ scheduler: SummaryScheduler; groupName: string; sendMode: string; schedule: string }> = [];

  for (const { groupId, sendMode, schedule } of config.targetGroups) {
    let groupName = await getGroupName(groupId);
    if (!groupName) groupName = groupId;

    const modeLabel = sendMode === 'group' ? '→ 群聊' : `→ 私聊 ${botQq}`;
    const schedLabel = schedule === 'daily' ? '每日1次' : '每日3次';
    logger.info('Main', `Group: ${groupId} (${groupName}) [${modeLabel}] [${schedLabel}]`);

    const scheduler = new SummaryScheduler({
      groupId,
      groupName,
      onebotHttpUrl: config.onebotHttpUrl,
      onebotToken: config.onebotToken,
      summaryGenerator,
      cardRenderer,
      sender,
      sendMode,
      botQq,
    });

    schedulerConfigs.push({ scheduler, groupName, sendMode, schedule });
  }

  // Separate groups by schedule
  const regularGroups = schedulerConfigs.filter(s => s.schedule !== 'daily');
  const dailyGroups = schedulerConfigs.filter(s => s.schedule === 'daily');

  // Run regular (3x/day) groups for a given period
  const runRegular = async (period: 'night' | 'daytime' | 'evening') => {
    if (regularGroups.length === 0) return;
    logger.info('Main', `=== ${period} summary triggered for ${regularGroups.length} group(s) ===`);
    for (const { scheduler, groupName } of regularGroups) {
      try {
        logger.info('Main', `Processing: ${groupName}`);
        await scheduler.runHalfDayPipeline(period);
      } catch (err: any) {
        const errMsg = err.code === 'ECONNABORTED' ? `timeout (${err.message})` : (err.message || String(err));
        logger.error('Main', `Failed: ${groupName} — ${errMsg}`);
      }
    }
    logger.info('Main', `=== ${period} summary complete ===`);
  };

  // Run daily groups (previous day summary, once at 17:30)
  const runDaily = async () => {
    if (dailyGroups.length === 0) return;
    logger.info('Main', `=== daily summary triggered for ${dailyGroups.length} group(s) ===`);
    for (const { scheduler, groupName } of dailyGroups) {
      try {
        logger.info('Main', `Processing daily: ${groupName}`);
        await scheduler.runHalfDayPipeline('daily');
      } catch (err: any) {
        const errMsg = err.code === 'ECONNABORTED' ? `timeout (${err.message})` : (err.message || String(err));
        logger.error('Main', `Failed: ${groupName} — ${errMsg}`);
      }
    }
    logger.info('Main', `=== daily summary complete ===`);
  };

  // Single set of cron jobs
  const cronTasks = [
    cron.schedule('30 7 * * *', () => { runRegular('night'); }),
    cron.schedule('30 17 * * *', async () => { await runRegular('daytime'); await runDaily(); }),
    cron.schedule('30 22 * * *', () => { runRegular('evening'); }),
  ];

  logger.info('Main', `Scheduled: 07:30 + 17:30 + 22:30 | regular: ${regularGroups.length}, daily: ${dailyGroups.length}`);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Main', 'Shutting down...');
    cronTasks.forEach(t => t.stop());
    await cardRenderer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error('Main', 'Fatal error', err);
  process.exit(1);
});
