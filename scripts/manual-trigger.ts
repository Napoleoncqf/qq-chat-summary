import { config } from '../src/utils/config';
import { logger } from '../src/utils/logger';
import { SummaryGenerator } from '../src/summary/gemini-client';
import { CardRenderer } from '../src/render/card-renderer';
import { OneBotSender } from '../src/sender/onebot-sender';
import { SummaryScheduler } from '../src/cron/scheduler';

async function main() {
  const botQq = config.botQq;

  const summaryGenerator = new SummaryGenerator({
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    llmApiKey: config.llmApiKey,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
  });

  const cardRenderer = new CardRenderer(config.templateDir, config.outputDir);
  const sender = new OneBotSender(config.onebotHttpUrl, config.onebotToken);

  // Yesterday 22:30 to today 17:30 — covers night + daytime
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 22, 30, 0);
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 30, 0);

  logger.info('Manual', `Time window: ${windowStart.toLocaleString()} → ${windowEnd.toLocaleString()}`);

  for (const { groupId, sendMode } of config.targetGroups) {
    const scheduler = new SummaryScheduler({
      groupId,
      groupName: groupId,
      onebotHttpUrl: config.onebotHttpUrl,
      onebotToken: config.onebotToken,
      summaryGenerator,
      cardRenderer,
      sender,
      sendMode,
      botQq,
    });

    try {
      logger.info('Manual', `Processing group ${groupId} (${sendMode})...`);
      await scheduler.runHalfDayPipeline('daytime', windowStart, windowEnd);
      logger.info('Manual', `Done: ${groupId}`);
    } catch (err: any) {
      logger.error('Manual', `Failed: ${groupId} — ${err.message}`);
    }
  }

  await cardRenderer.close();
  logger.info('Manual', 'All done');
}

main().catch(err => {
  logger.error('Manual', 'Fatal', err);
  process.exit(1);
});
