import ejs from 'ejs';
import path from 'path';
import fs from 'fs';
import { chromium, Browser } from 'playwright';
import { DailySummary, RoastResult } from '../summary/types';
import { logger } from '../utils/logger';

export class CardRenderer {
  private templatePath: string;
  private outputDir: string;

  private roastTemplatePath: string;

  constructor(templateDir: string, outputDir: string) {
    this.templatePath = path.join(templateDir, 'card.ejs');
    this.roastTemplatePath = path.join(templateDir, 'roast.ejs');
    this.outputDir = outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  async render(summary: DailySummary): Promise<string[]> {
    const needsSplit = this.shouldSplit(summary);
    const outputPaths: string[] = [];

    // Safe filename: only keep alphanumeric, dash, underscore
    const safeDate = summary.date.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/_$/,'');
    const ts = Date.now();

    if (needsSplit) {
      const html1 = await this.renderTemplate(summary, 0);
      const path1 = path.join(this.outputDir, `summary_${safeDate}_${ts}_1.png`);
      await this.screenshotHtml(html1, path1);
      outputPaths.push(path1);

      const html2 = await this.renderTemplate(summary, 1);
      const path2 = path.join(this.outputDir, `summary_${safeDate}_${ts}_2.png`);
      await this.screenshotHtml(html2, path2);
      outputPaths.push(path2);
    } else {
      const html = await this.renderTemplate(summary, undefined);
      const outputPath = path.join(this.outputDir, `summary_${safeDate}_${ts}.png`);
      await this.screenshotHtml(html, outputPath);
      outputPaths.push(outputPath);
    }

    logger.info('Render', `Generated ${outputPaths.length} card image(s)`);
    return outputPaths;
  }

  private shouldSplit(summary: DailySummary): boolean {
    // Split if there's significant content in both halves
    const topicCount = summary.topics.length;
    const highlightCount = summary.highlights.length;
    const modCount = summary.moderation.length;
    const resourceCount = summary.resources.length;

    // Rough heuristic: split when total content items exceed threshold
    const totalItems = topicCount + highlightCount + modCount + resourceCount;
    return totalItems > 12;
  }

  private async renderTemplate(summary: DailySummary, pageIndex: number | undefined): Promise<string> {
    const template = fs.readFileSync(this.templatePath, 'utf-8');

    const now = new Date();
    const generatedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Escape all user content to prevent XSS/SSRF
    const safeSummary = this.sanitizeSummary(summary);

    const html = ejs.render(template, {
      ...safeSummary,
      pageIndex,
      generatedAt,
    });

    return html;
  }

  private sanitizeSummary(summary: DailySummary): DailySummary {
    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    return {
      ...summary,
      topics: summary.topics.map(t => ({
        title: escapeHtml(t.title),
        summary: escapeHtml(t.summary),
        participants: t.participants.map(escapeHtml),
      })),
      highlights: summary.highlights.map(h => ({
        user: escapeHtml(h.user),
        content: escapeHtml(h.content),
        comment: escapeHtml(h.comment),
      })),
      ranking: summary.ranking.map(r => ({
        user: escapeHtml(r.user),
        count: r.count,
      })),
      moderation: summary.moderation.map(m => ({
        type: escapeHtml(m.type),
        user: escapeHtml(m.user),
        content: escapeHtml(m.content),
        reason: escapeHtml(m.reason),
      })),
      resources: summary.resources.map(r => ({
        user: escapeHtml(r.user),
        url: escapeHtml(r.url),
        description: escapeHtml(r.description),
      })),
    };
  }

  async renderRoast(roast: RoastResult): Promise<string> {
    const template = fs.readFileSync(this.roastTemplatePath, 'utf-8');

    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const safeRoast = {
      ...roast,
      items: roast.items.map(item => ({
        ...item,
        user: escapeHtml(item.user),
        roast: escapeHtml(item.roast),
      })),
    };

    const html = ejs.render(template, safeRoast);
    const safeDate = roast.date_range.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    const outputPath = path.join(this.outputDir, `roast_${safeDate}_${Date.now()}.png`);
    await this.screenshotHtml(html, outputPath);
    return outputPath;
  }

  async screenshotHtml(html: string, outputPath: string): Promise<void> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 520, height: 800 },
      });

      await page.setContent(html, { waitUntil: 'networkidle' });

      // Get actual content height
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);

      await page.setViewportSize({ width: 520, height: bodyHeight });

      await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: 'png',
      });

      logger.info('Render', `Screenshot saved: ${outputPath}`);
    } catch (err) {
      logger.error('Render', `Screenshot failed`, err);
      throw err;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
