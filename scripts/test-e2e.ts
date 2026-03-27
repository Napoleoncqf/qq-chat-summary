/**
 * End-to-end test: run summary pipeline on a time window with forwarded messages.
 * Skips sending — only generates summary + cards.
 *
 * Usage: npx tsx scripts/test-e2e.ts
 */
import { config } from '../src/utils/config';
import { SummaryGenerator } from '../src/summary/gemini-client';
import { CardRenderer } from '../src/render/card-renderer';
import { OneBotSender } from '../src/sender/onebot-sender';
import { SummaryScheduler } from '../src/cron/scheduler';
import { logger } from '../src/utils/logger';

async function main() {
  const groupId = config.targetGroups[0]?.groupId || '247592449';
  const groupName = 'E2E测试群';

  logger.info('Test', '=== E2E Forward Expansion Test ===');

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
    groupId,
    groupName,
    onebotHttpUrl: config.onebotHttpUrl,
    onebotToken: config.onebotToken,
    summaryGenerator,
    cardRenderer,
    sender,
    sendMode: 'private',
    botQq: config.botQq || '3563167318',
  });

  // Time window: 2026-03-27 17:30 to 22:30 (evening period, contains forward messages)
  const windowStart = new Date(2026, 2, 27, 17, 30, 0);
  const windowEnd = new Date(2026, 2, 27, 22, 30, 0);

  logger.info('Test', `Window: ${windowStart.toLocaleString()} → ${windowEnd.toLocaleString()}`);

  try {
    const imagePaths = await scheduler.runHalfDayPipeline('evening', windowStart, windowEnd);
    logger.info('Test', `Generated ${imagePaths.length} card image(s):`);
    for (const p of imagePaths) {
      logger.info('Test', `  ${p}`);
    }
  } catch (err: any) {
    logger.error('Test', 'Pipeline failed', err);
  }

  await cardRenderer.close();
  logger.info('Test', '=== Test complete ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
