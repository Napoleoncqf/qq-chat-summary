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
  const schedulerConfigs: Array<{ scheduler: SummaryScheduler; groupName: string; sendMode: string }> = [];

  for (const { groupId, sendMode } of config.targetGroups) {
    let groupName = await getGroupName(groupId);
    if (!groupName) groupName = groupId;

    const modeLabel = sendMode === 'group' ? '→ 群聊' : `→ 私聊 ${botQq}`;
    logger.info('Main', `Group: ${groupId} (${groupName}) [${modeLabel}]`);

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

    schedulerConfigs.push({ scheduler, groupName, sendMode });
  }

  // Run all groups sequentially for a given period
  const runAll = async (period: 'night' | 'daytime' | 'evening') => {
    logger.info('Main', `=== ${period} summary triggered for ${schedulerConfigs.length} group(s) ===`);
    for (const { scheduler, groupName } of schedulerConfigs) {
      try {
        logger.info('Main', `Processing: ${groupName}`);
        await scheduler.runHalfDayPipeline(period);
      } catch (err) {
        logger.error('Main', `Failed: ${groupName}`, err);
      }
    }
    logger.info('Main', `=== ${period} summary complete ===`);
  };

  // Single set of cron jobs, groups processed sequentially
  const cronTasks = [
    cron.schedule('30 7 * * *', () => { runAll('night'); }),
    cron.schedule('30 17 * * *', () => { runAll('daytime'); }),
    cron.schedule('30 22 * * *', () => { runAll('evening'); }),
  ];

  logger.info('Main', `Scheduled: 07:30 + 17:30 + 22:30 (${config.targetGroups.length} groups, sequential)`);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Main', 'Shutting down...');
    cronTasks.forEach(t => t.stop());
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error('Main', 'Fatal error', err);
  process.exit(1);
});
