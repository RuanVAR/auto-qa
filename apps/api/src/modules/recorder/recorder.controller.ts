import { Controller, Get, Post, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RecorderService } from './recorder.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import type { FastifyReply } from 'fastify';
import * as path from 'path';
import * as fs from 'fs';
// archiver ships CJS-only; with esModuleInterop off we have to import it
// via TS's CJS-interop syntax. `import archiver from 'archiver'` compiles
// to `archiver_1.default` which is undefined at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as typeof import('archiver');

@ApiTags('recorder') @ApiBearerAuth()
@Controller('recorder')
export class RecorderController {
  constructor(private readonly service: RecorderService) {}

  /**
   * Create a new recording session. The viewer (RecorderPage) calls this when
   * the user clicks "Record". The returned `code` is displayed in the UI and
   * typed by the user into the Chrome extension popup to pair them up.
   */
  @Post('sessions') @ApiOperation({ summary: 'Create a recording session' })
  createSession(@CurrentUser() user: JwtPayload) {
    const s = this.service.createSession(user.sub);
    return {
      id: s.id,
      code: s.code,
      expiresAt: s.expiresAt.toISOString(),
    };
  }

  /**
   * Streams the recorder Chrome extension as a zip. Served publicly because
   * the user needs to download it BEFORE they have an authenticated session
   * with the platform (signed-in users typically also, but no reason to gate
   * a static asset).
   */
  @Public()
  @Get('extension.zip')
  @ApiOperation({ summary: 'Download the QA Recorder Chrome extension as a zip' })
  downloadExtension(@Res() res: FastifyReply) {
    // The API process can be CWD'd at the repo root (/app inside the dev
    // container) or at apps/api (some CI runners). Try both, plus a __dirname-
    // relative path as a last resort.
    const candidates = [
      path.resolve(process.cwd(), 'apps/recorder-extension'),
      path.resolve(process.cwd(), '../../apps/recorder-extension'),
      path.resolve(process.cwd(), '../recorder-extension'),
      path.resolve(__dirname, '../../../../../apps/recorder-extension'),
    ];
    const extDir = candidates.find((p) => fs.existsSync(path.join(p, 'manifest.json')));
    if (!extDir) {
      return res.status(500).send({ message: 'Extension source not found on server' });
    }

    res
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="qa-recorder-extension.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      // If headers haven't been sent yet, surface a clean 500; otherwise
      // end the stream — the client gets a truncated download which is
      // better than a hung connection.
      if (!res.sent) res.status(500).send({ message: err.message });
      else res.raw.end();
    });
    archive.directory(extDir, false, (entry) => {
      // Skip the README — useful for humans, not needed at runtime.
      if (entry.name === 'README.md') return false;
      return entry;
    });
    archive.finalize();
    // Fastify wants either `.send(payload)` or returning the payload. For
    // streams we hand the raw Node response to archiver and tell Fastify
    // we've taken over via `.send(stream)`.
    return res.send(archive);
  }
}
