import { Controller, Get, Put, Post, Param, Body, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { SignoffService, SubmitApprovalDto, ModuleSignoffDto } from './signoff.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('signoff') @ApiBearerAuth()
@Controller()
export class SignoffController {
  constructor(private readonly service: SignoffService) {}

  @Get('projects/:projectId/signoff/overview')
  @ApiOperation({ summary: 'Project sign-off matrix — modules × features × environments' })
  overview(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.service.getProjectOverview(projectId, user, includeArchived === 'true' || includeArchived === '1');
  }

  @Get('projects/:projectId/signoff/config')
  @ApiOperation({ summary: 'Get sign-off approver config' })
  getConfig(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.service.getConfig(projectId, user);
  }

  @Put('projects/:projectId/signoff/config')
  @ApiOperation({ summary: 'Set sign-off approvers (managers only)' })
  setConfig(
    @Param('projectId') projectId: string,
    @Body() dto: { approvers: { environmentId: string | null; userId: string }[] },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.setConfig(projectId, user, dto);
  }

  @Get('projects/:projectId/signoff/history')
  @ApiOperation({ summary: 'Sign-off audit history' })
  history(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.service.getHistory(projectId, user);
  }

  @Get('features/:featureId/environments/:envId/signoff')
  @ApiOperation({ summary: 'Sign-off cell detail for a feature × environment' })
  cellDetail(
    @Param('featureId') featureId: string,
    @Param('envId') envId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getCellDetail(featureId, envId, user);
  }

  @Post('features/:featureId/environments/:envId/signoff')
  @ApiOperation({ summary: 'Submit a sign-off approval/rejection (designated approvers only)' })
  submit(
    @Param('featureId') featureId: string,
    @Param('envId') envId: string,
    @Body() dto: SubmitApprovalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.submitApproval(featureId, envId, user, dto);
  }

  @Post('features/:featureId/environments/:envId/signoff/resend')
  @ApiOperation({ summary: 'Resend the sign-off request to approvers who have not yet responded' })
  resend(
    @Param('featureId') featureId: string,
    @Param('envId') envId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.resendSignoffRequest(featureId, envId, user);
  }

  @Post('modules/:moduleId/environments/:envId/signoff')
  @ApiOperation({ summary: 'Officially sign off a module in an environment (managers only)' })
  signOffModule(
    @Param('moduleId') moduleId: string,
    @Param('envId') envId: string,
    @Body() dto: ModuleSignoffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.signOffModule(moduleId, envId, user, dto);
  }

  @Post('features/:featureId/environments/:envId/signoff/certificate/email')
  @ApiOperation({ summary: 'Email the sign-off certificate (defaults to all approvers)' })
  emailCertificate(
    @Param('featureId') featureId: string,
    @Param('envId') envId: string,
    @Body() body: { recipients?: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.emailCertificate(featureId, envId, user, body?.recipients);
  }

  @Get('signoff/certificate.pdf')
  @ApiOperation({ summary: 'Sign-off certificate rendered to PDF (feature or module scope)' })
  async certificatePdf(
    @Query('scope') scope: 'feature' | 'module',
    @Query('id') id: string,
    @Query('envId') envId: string,
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ) {
    const pdf = await this.service.getCertificatePdf(scope === 'module' ? 'module' : 'feature', id, envId, user);
    if (!pdf) {
      reply.status(503).send({ message: 'Certificate PDF could not be generated — try again shortly.' });
      return;
    }
    reply.headers({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="signoff-certificate.pdf"',
    });
    reply.send(pdf);
  }

  @Get('signoff/certificate')
  @ApiOperation({ summary: 'Print-ready HTML sign-off certificate (feature or module scope)' })
  async certificate(
    @Query('scope') scope: 'feature' | 'module',
    @Query('id') id: string,
    @Query('envId') envId: string,
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.service.getCertificateHtml(scope === 'module' ? 'module' : 'feature', id, envId, user);
    reply.headers({ 'Content-Type': 'text/html; charset=utf-8' });
    reply.send(html);
  }
}
