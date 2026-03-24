import ejs from 'ejs';
import path from 'path';
import fs from 'fs';
import { chromium, Browser } from 'playwright';
import { DailySummary, RoastResult, TopicBreakdown } from '../summary/types';
import { logger } from '../utils/logger';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class CardRenderer {
  private templatePath: string;
  private outputDir: string;
  private roastTemplatePath: string;
  private breakdownTemplatePath: string;
  private browser: Browser | null = null;

  constructor(templateDir: string, outputDir: string) {
    this.templatePath = path.join(templateDir, 'card.ejs');
    this.roastTemplatePath = path.join(templateDir, 'roast.ejs');
    this.breakdownTemplatePath = path.join(templateDir, 'breakdown.ejs');
    this.outputDir = outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true, timeout: 30000 });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async render(summary: DailySummary, theme: 'light' | 'dark' = 'dark'): Promise<string[]> {
    const outputPaths: string[] = [];

    // Safe filename: only keep alphanumeric, dash, underscore
    const safeDate = summary.date.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/_$/,'');
    const ts = Date.now();

    const html = await this.renderTemplate(summary, theme);
    const outputPath = path.join(this.outputDir, `summary_${safeDate}_${ts}.png`);
    await this.screenshotHtml(html, outputPath);
    outputPaths.push(outputPath);

    logger.info('Render', `Generated ${outputPaths.length} card image(s)`);
    return outputPaths;
  }

  private async renderTemplate(summary: DailySummary, theme: 'light' | 'dark' = 'dark'): Promise<string> {
    const template = fs.readFileSync(this.templatePath, 'utf-8');

    const now = new Date();
    const generatedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Escape all user content to prevent XSS/SSRF
    const safeSummary = this.sanitizeSummary(summary);

    const html = ejs.render(template, {
      ...safeSummary,
      generatedAt,
      theme,
    });

    return html;
  }

  private sanitizeSummary(summary: DailySummary): DailySummary {
    return {
      ...summary,
      group_name: escapeHtml(summary.group_name),
      date: escapeHtml(summary.date),
      topics: summary.topics.map(t => ({
        title: escapeHtml(t.title),
        summary: escapeHtml(t.summary),
        participants: t.participants.map(escapeHtml),
      })),
      highlights: summary.highlights.map(h => ({
        user: escapeHtml(h.user),
        content: escapeHtml(h.content),
      })),
      ranking: summary.ranking.map(r => ({
        user: escapeHtml(r.user),
        count: r.count,
      })),
    };
  }

  async renderRoast(roast: RoastResult, theme: 'light' | 'dark' = 'dark'): Promise<string> {
    const template = fs.readFileSync(this.roastTemplatePath, 'utf-8');

    const safeRoast = {
      ...roast,
      group_name: escapeHtml(roast.group_name),
      date_range: escapeHtml(roast.date_range),
      items: roast.items.map(item => ({
        ...item,
        user: escapeHtml(item.user),
        roast: escapeHtml(item.roast),
      })),
    };

    const html = ejs.render(template, { ...safeRoast, theme });
    const safeDate = roast.date_range.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    const outputPath = path.join(this.outputDir, `roast_${safeDate}_${Date.now()}.png`);
    await this.screenshotHtml(html, outputPath);
    return outputPath;
  }

  async renderBreakdown(breakdown: TopicBreakdown, theme: 'light' | 'dark' = 'dark'): Promise<string> {
    const template = fs.readFileSync(this.breakdownTemplatePath, 'utf-8');

    const safeBreakdown = {
      ...breakdown,
      group_name: escapeHtml(breakdown.group_name),
      date_range: escapeHtml(breakdown.date_range),
      overall_comment_title: escapeHtml(breakdown.overall_comment_title),
      overall_comment: escapeHtml(breakdown.overall_comment),
      categories: breakdown.categories.map(c => ({
        ...c,
        category: escapeHtml(c.category),
        title: escapeHtml(c.title),
        description: escapeHtml(c.description),
      })),
    };

    const html = ejs.render(template, { ...safeBreakdown, theme });
    const safeDate = breakdown.date_range.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    const outputPath = path.join(this.outputDir, `breakdown_${safeDate}_${Date.now()}.png`);
    await this.screenshotHtml(html, outputPath);
    return outputPath;
  }

  async screenshotHtml(html: string, outputPath: string): Promise<void> {
    const browser = await this.getBrowser();
    const page = await browser.newPage({
      viewport: { width: 520, height: 800 },
    });

    try {
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });

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
      await page.close();
    }
  }
}
