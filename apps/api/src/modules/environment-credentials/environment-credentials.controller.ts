import { Controller, Get, Put, Delete, Param, Body, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvironmentCredentialsService } from './environment-credentials.service';

// Project roles allowed to MANAGE environment credentials ("QA leads"): the
// same set that manages environments. Org/platform admins always allowed.
const LEAD_ROLES = new Set(['OWNER', 'TECH_LEAD', 'MANAGER']);

@ApiTags('environment-credentials')
@ApiBearerAuth()
@Controller('projects/:projectId/environments/:envId/credentials')
export class EnvironmentCredentialsController {
  constructor(
    private readonly service: EnvironmentCredentialsService,
    private readonly prisma: PrismaService,
  ) {}

  private async assertCanManage(projectId: string, user: JwtPayload) {
    if (user.orgRole === 'ORG_ADMIN' || user.platformRole === 'PLATFORM_ADMIN') return;
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.sub } },
      select: { role: true },
    });
    if (!m || !LEAD_ROLES.has(m.role)) {
      throw new ForbiddenException('Only project leads (Owner / Tech Lead / Manager) or org admins can manage environment credentials');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List credential names + field keys for an environment (no secret values)' })
  list(@Param('envId') envId: string) {
    return this.service.list(envId);
  }

  @Put(':name')
  @ApiOperation({ summary: 'Create or replace a named credential (encrypted at rest)' })
  async upsert(
    @Param('projectId') projectId: string,
    @Param('envId') envId: string,
    @Param('name') name: string,
    @Body() body: { fields: Record<string, string> },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanManage(projectId, user);
    return this.service.upsert(envId, name, body?.fields ?? {}, user?.sub);
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a named credential' })
  async remove(
    @Param('projectId') projectId: string,
    @Param('envId') envId: string,
    @Param('name') name: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanManage(projectId, user);
    return this.service.remove(envId, name);
  }
}
