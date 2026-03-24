/**
 * Manual test: run summary pipeline for a single group.
 * Usage: npx tsx scripts/test-single.ts [groupId] [period]
 *   groupId: defaults to first group in TARGET_GROUP_IDS
 *   period:  night | daytime | evening | daily (default: daytime)
 */
import { config } from '../src/utils/config';
import { logger } from '../src/utils/logger';
import { SummaryGenerator } from '../src/summary/gemini-client';
import { CardRenderer } from '../src/render/card-renderer';
import { OneBotSender } from '../src/sender/onebot-sender';
import { SummaryScheduler } from '../src/cron/scheduler';

async function main() {
  const targetGroupId = process.argv[2] || config.targetGroups[0]?.groupId;
  const period = (process.argv[3] || 'daytime') as 'night' | 'daytime' | 'evening' | 'daily';

  if (!targetGroupId) {
    logger.error('Test', 'No group ID provided and TARGET_GROUP_IDS is empty');
    process.exit(1);
  }

  const groupConfig = config.targetGroups.find(g => g.groupId === targetGroupId);
  const sendMode = groupConfig?.sendMode || 'private';
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

  const scheduler = new SummaryScheduler({
    groupId: targetGroupId,
    groupName: targetGroupId,
    onebotHttpUrl: config.onebotHttpUrl,
    onebotToken: config.onebotToken,
    summaryGenerator,
    cardRenderer,
    sender,
    sendMode,
    botQq,
  });

  logger.info('Test', `Running ${period} pipeline for group ${targetGroupId} (${sendMode})...`);
  const paths = await scheduler.runHalfDayPipeline(period);
  logger.info('Test', `Generated ${paths.length} images: ${paths.join(', ')}`);

  await cardRenderer.close();
  logger.info('Test', 'Done');
}

main().catch(err => {
  logger.error('Test', 'Fatal', err);
  process.exit(1);
});
