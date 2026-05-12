import { Worker, Job } from 'bullmq';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { getPrisma } from '../utils/prisma';

export interface ReportPdfJobData {
  reportId: string;
  projectId: string;
  html: string;
}

export function createReportPdfWorker() {
  return new Worker<ReportPdfJobData>(
    'report-pdf',
    async (job: Job<ReportPdfJobData>) => {
      const { reportId, projectId, html } = job.data;
      const storagePath = process.env.ARTIFACT_STORAGE_PATH ?? './artifacts';
      const reportsDir = path.join(storagePath, 'reports', projectId);
      fs.mkdirSync(reportsDir, { recursive: true });
      const filePath = path.join(reportsDir, `${reportId}.pdf`);

      const browser = await chromium.launch({ headless: true });
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.emulateMedia({ media: 'screen' });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(async () => {
          if ('fonts' in document) {
            await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
          }
        });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
        });
        fs.writeFileSync(filePath, pdf);

        const relPath = path.relative(storagePath, filePath);
        await getPrisma().generatedReport.update({
          where: { id: reportId },
          data: { artifactPath: relPath },
        });
      } finally {
        await browser.close().catch(() => {});
      }
    },
    {
      connection: { url: process.env.REDIS_URL! },
      concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '3', 10),
    },
  );
}
