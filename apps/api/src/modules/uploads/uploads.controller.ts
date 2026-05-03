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

const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif)|video\/(webm|mp4|quicktime))$/;
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

  /** Public — token IS the access control */
  @Public()
  @Get(':token')
  async stream(
    @Param('token') token: string,
    @Res() res: FastifyReply,
  ) {
    const { stream, mimeType, filename } = await this.uploadsService.getFileStream(token);
    res.header('Content-Type', mimeType);
    res.header('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.header('Cache-Control', 'private, max-age=3600');
    res.send(stream);
  }

  @Delete(':token')
  async remove(@Param('token') token: string) {
    await this.uploadsService.remove(token);
    return { ok: true };
  }
}
