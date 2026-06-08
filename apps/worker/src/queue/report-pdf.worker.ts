import { Worker, Job } from 'bullmq';
import { chromium } from 'playwright';
import { createStorageProvider } from '@qa-platform/storage';
import { getPrisma } from '../utils/prisma';

export interface ReportPdfJobData {
  reportId: string;
  projectId: string;
  html: string;
  /** Skip the GeneratedReport row update — used for ad-hoc renders (e.g. the
   *  sign-off certificate) that have no GeneratedReport row, only need the PDF. */
  skipDbUpdate?: boolean;
}

export function createReportPdfWorker() {
  return new Worker<ReportPdfJobData>(
    'report-pdf',
    async (job: Job<ReportPdfJobData>) => {
      const { reportId, projectId, html } = job.data;
      // Same storage backend as run artifacts (STORAGE_PROVIDER); local
      // fallback roots at ARTIFACT_STORAGE_PATH so the key resolves to the
      // same on-disk location reports used before.
      const storage = createStorageProvider(process.env, {
        localBasePath: process.env.ARTIFACT_STORAGE_PATH ?? './artifacts',
      });
      const key = `reports/${projectId}/${reportId}.pdf`;

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
        await storage.upload(key, pdf, 'application/pdf');

        if (!job.data.skipDbUpdate) {
          await getPrisma().generatedReport.update({
            where: { id: reportId },
            data: { artifactPath: key },
          });
        }
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
