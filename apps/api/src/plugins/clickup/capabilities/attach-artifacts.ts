import axios from 'axios';
import type { PluginCtx } from '../../types';
import type { AttachArtifactsInput, AttachArtifactsOutput } from '../../capabilities';
import type { ClickUpBindingConfig, ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { ensureWriteAllowed } from '../write-guard';
import { Logger } from '@nestjs/common';

const logger = new Logger('ClickUpAttachArtifacts');

/**
 * attachArtifacts — POST /task/{taskId}/attachment for each artifact.
 *
 * Per-kind size caps (configurable via binding.attachRecordingMaxMb for recordings):
 *   - screenshot: 10 MB
 *   - recording:  binding.attachRecordingMaxMb (default 50)
 *   - log/HAR:    5 MB
 *   - other:      10 MB
 *
 * Fallback: when an artifact exceeds its cap or upload fails, append a signed
 * download URL into the task's markdown_description rather than throwing the
 * whole batch. Each fallback is tracked in the output so the caller can show
 * a partial-success badge in the UI.
 */
const KIND_CAPS_MB: Record<NonNullable<AttachArtifactsInput['artifacts'][number]['kind']>, number> = {
  screenshot: 10,
  recording: 50,                                 // overridden per-binding below
  log: 5,
  har: 5,
  trace: 25,
  other: 10,
};

export async function attachArtifacts(
  ctx: PluginCtx<ClickUpInstallConfig & ClickUpBindingConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<AttachArtifactsOutput> {
  const input = payload as AttachArtifactsInput;
  const cfg = ctx.config as ClickUpBindingConfig;
  const recordingCapMb = cfg.attachRecordingMaxMb ?? 50;

  // Resolve list id from the task once, gate writes against it.
  const client = new ClickUpClient(ctx.http);
  const task = await client.getTask(input.externalId);
  ensureWriteAllowed('attachArtifacts', task.list?.id ?? null);

  const uploaded: AttachArtifactsOutput['uploaded'] = [];
  const fallbackToDescription: AttachArtifactsOutput['fallbackToDescription'] = [];

  const fallbackUrls: string[] = [];

  for (const a of input.artifacts) {
    const kind = a.kind ?? 'other';
    const capMb = kind === 'recording' ? recordingCapMb : KIND_CAPS_MB[kind];
    const sizeMb = a.sizeBytes ? a.sizeBytes / 1_000_000 : undefined;

    if (sizeMb !== undefined && sizeMb > capMb) {
      fallbackToDescription.push({ filename: a.filename, reason: `exceeds ${capMb}MB cap (got ${sizeMb.toFixed(1)}MB)` });
      fallbackUrls.push(`- [${a.filename} (${sizeMb.toFixed(1)} MB)](${a.url})`);
      continue;
    }

    try {
      // Pull the artifact bytes via signed URL (caller-supplied; not auth'd).
      const dl = await axios.get<ArrayBuffer>(a.url, { responseType: 'arraybuffer', timeout: 60_000 });
      const buf = Buffer.from(dl.data);
      const result = await client.attachToTask(input.externalId, {
        buffer: buf,
        filename: a.filename,
        contentType: a.contentType,
      });
      uploaded.push({
        filename: a.filename,
        externalAttachmentId: result.id,
        externalUrl: result.url,
      });
    } catch (err) {
      logger.warn(`attach failed for ${a.filename}: ${(err as Error).message}`);
      fallbackToDescription.push({ filename: a.filename, reason: (err as Error).message });
      fallbackUrls.push(`- [${a.filename}](${a.url})`);
    }
  }

  // If anything fell back, append a section to the description.
  if (fallbackUrls.length > 0) {
    try {
      const existing = await client.getTask(input.externalId, { includeMarkdown: true });
      const banner = `\n\n## Linked artefacts (uploaded externally)\n${fallbackUrls.join('\n')}\n`;
      await client.updateTask(input.externalId, {
        markdown_description: (existing.markdown_description ?? '') + banner,
      });
    } catch (err) {
      logger.warn(`description-fallback append failed: ${(err as Error).message}`);
    }
  }

  return { uploaded, fallbackToDescription };
}
