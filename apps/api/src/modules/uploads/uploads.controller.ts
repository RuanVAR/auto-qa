import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { UploadsService } from './uploads.service';
import { Public } from '../../common/decorators/public.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif|svg\+xml)|video\/(webm|mp4|quicktime))$/;
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

interface AuthRequest extends FastifyRequest {
  user: { sub: string; activeOrgId: string; [k: string]: unknown };
}

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  async upload(@Req() req: AuthRequest) {
    // Fastify multipart — read the first file part
    const data = await req.file();
    if (!data) throw new BadRequestException('No file provided');

    if (!ALLOWED_MIME.test(data.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${data.mimetype}. Allowed: images and videos.`,
      );
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException('File exceeds 200 MB limit');
    }

    const multerLike = {
      originalname: data.filename,
      mimetype: data.mimetype,
      buffer,
      size: buffer.length,
    } as Express.Multer.File;

    const userId = req.user.sub;
    const orgId = req.user.activeOrgId;
    return this.uploadsService.upload(multerLike, orgId, userId);
  }

  /** Public — token IS the access control. Range + Content-Length support so
   *  `<video src>` on the web app (cross-origin) can seek and decode; without
   *  it many browsers only play after opening the URL in a new tab. */
  @Public()
  @Get(':token')
  async stream(
    @Param('token') token: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;

    const baseHeaders = (mimeType: string, filename: string) => {
      res.header('Content-Type', mimeType);
      res.header('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.header('Cache-Control', 'private, max-age=3600');
      res.header('Accept-Ranges', 'bytes');
      // CORB fix — without this Chrome blocks the response when an <img>
      // / <video> on the web app (different origin) requests it, even
      // though the endpoint is @Public(). Symptom in the console is
      // `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`. The token IS the access
      // control; cross-origin reads are explicitly allowed.
      res.header('Cross-Origin-Resource-Policy', 'cross-origin');
      // Never let the browser sniff a different type than declared.
      res.header('X-Content-Type-Options', 'nosniff');
      // SVGs can embed <script>. Rendered via <img> they never execute, but
      // a directly-opened SVG URL would run scripts on this origin (stored
      // XSS). `sandbox` forces a unique, script-disabled origin for the
      // resource, neutralising that while still rendering the vector art.
      if (mimeType === 'image/svg+xml') {
        res.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }
    };

    const d = await this.uploadsService.openDownload(token);
    baseHeaders(d.mimeType, d.filename);

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        let end = match[2] ? parseInt(match[2], 10) : d.size - 1;
        if (Number.isNaN(end) || end >= d.size) end = d.size - 1;
        if (start >= d.size || start > end) {
          res.header('Content-Range', `bytes */${d.size}`);
          res.code(416).send();
          return;
        }
        const stream = await d.streamRange(start, end);
        const chunkSize = end - start + 1;
        res.header('Content-Length', String(chunkSize));
        res.header('Content-Range', `bytes ${start}-${end}/${d.size}`);
        res.code(206).send(stream);
        return;
      }
    }

    const stream = await d.streamFull();
    res.header('Content-Length', String(d.size));
    res.send(stream);
  }

  @Delete(':token')
  async remove(@Param('token') token: string) {
    await this.uploadsService.remove(token);
    return { ok: true };
  }
}
