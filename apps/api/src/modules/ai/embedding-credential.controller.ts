import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { UpsertEmbeddingCredentialDto } from './dto/upsert-embedding-credential.dto';
import { EmbeddingCredentialService } from './embedding-credential.service';

@ApiTags('embedding-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class EmbeddingCredentialController {
  constructor(private readonly service: EmbeddingCredentialService) {}

  @Get('orgs/:orgId/embedding-credential')
  @ApiOperation({ summary: 'Get the org embedding credential with its API key masked' })
  get(@Param('orgId') orgId: string) {
    return this.service.getMasked(orgId);
  }

  @Put('orgs/:orgId/embedding-credential')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Probe and save the org embedding credential' })
  upsert(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertEmbeddingCredentialDto,
  ) {
    return this.service.upsert(orgId, user.sub, dto);
  }

  @Post('orgs/:orgId/embedding-credential/test')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Probe a draft or saved embedding configuration' })
  test(
    @Param('orgId') orgId: string,
    @Body() dto: UpsertEmbeddingCredentialDto,
  ) {
    return this.service.test(orgId, dto);
  }

  @Delete('orgs/:orgId/embedding-credential')
  @OrgRoles('ORG_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the embedding credential and block its indexes' })
  async remove(@Param('orgId') orgId: string) {
    await this.service.remove(orgId);
  }
}
