import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiProvider } from '@prisma/client';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { AiCredentialService, UpsertCredentialInput } from './ai-credential.service';

/**
 * Per-org BYOK CRUD + spend rollup. Read endpoints are open to any org
 * member so the rest of the app can render "AI configured?" badges; write
 * endpoints require ORG_ADMIN. Plaintext API keys never leave the server —
 * GET returns `••••••••` in the `apiKey` field, never the real value.
 */
@ApiTags('ai-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class AiCredentialController {
  constructor(private readonly service: AiCredentialService) {}

  @Get('orgs/:orgId/ai-credential')
  @ApiOperation({ summary: 'Get the org AI credential (masked) — null if not configured' })
  get(@Param('orgId') orgId: string) {
    return this.service.getMasked(orgId);
  }

  @Put('orgs/:orgId/ai-credential')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Create or update the org AI credential (re-encrypts key)' })
  upsert(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: UpsertCredentialPayload,
  ) {
    return this.service.upsert(orgId, user.sub, normalisePayload(body));
  }

  @Delete('orgs/:orgId/ai-credential')
  @OrgRoles('ORG_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the org AI credential (zeroes ciphertext)' })
  async remove(@Param('orgId') orgId: string) {
    await this.service.delete(orgId);
  }

  @Post('orgs/:orgId/ai-credential/test')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Probe the configured (or draft) provider with a 1-token call' })
  test(@Param('orgId') orgId: string, @Body() body: UpsertCredentialPayload) {
    return this.service.testConnection(orgId, normalisePayload(body));
  }

  @Get('orgs/:orgId/ai/spend')
  @ApiOperation({ summary: 'Monthly spend rollup. ?month=YYYY-MM (defaults to current month, UTC)' })
  spend(@Param('orgId') orgId: string, @Query('month') month?: string) {
    return this.service.monthlySpend(orgId, month);
  }
}

/**
 * Wire-shape from the frontend. The controller layer is thin; the service
 * does the real validation. `provider` is the only hard requirement — every
 * other field is optional and falls back to either the existing row or a
 * sane default in the service.
 */
type UpsertCredentialPayload = {
  provider: AiProvider | string;
  model?: string;
  apiKey?: string | null;
  maxTokens?: number;
  baseUrl?: string;
  azureInstance?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
  monthlyCapUsd?: number;
  rateLimitPerUserPerHour?: number;
};

function normalisePayload(body: UpsertCredentialPayload): UpsertCredentialInput {
  return {
    ...body,
    provider: body.provider as AiProvider,
  };
}
