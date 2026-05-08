import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { IssuesService } from './issues.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListIssuesDto } from './dto/list-issues.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('issues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class IssuesController {
  constructor(private readonly service: IssuesService) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────────

  @Post('projects/:projectId/issues')
  @ApiOperation({ summary: 'Log a new bug / snag / query against a project' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIssueDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(projectId, dto, user.sub);
  }

  // ─── LIST ────────────────────────────────────────────────────────────────────

  @Get('projects/:projectId/issues')
  @ApiOperation({ summary: 'List issues for a project (filterable)' })
  async findAll(
    @Param('projectId') projectId: string,
    @Query() query: ListIssuesDto,
  ) {
    return this.service.findAll(projectId, query);
  }

  // ─── STATS ───────────────────────────────────────────────────────────────────

  @Get('projects/:projectId/issues/stats')
  @ApiOperation({ summary: 'Aggregated issue stats for a project' })
  async projectStats(@Param('projectId') projectId: string) {
    return this.service.getStats({ projectId });
  }

  @Get('modules/:moduleId/issues/stats')
  @ApiOperation({ summary: 'Aggregated issue stats for a module' })
  async moduleStats(@Param('moduleId') moduleId: string) {
    return this.service.getStats({ moduleId });
  }

  @Get('features/:featureId/issues/stats')
  @ApiOperation({ summary: 'Aggregated issue stats for a feature' })
  async featureStats(@Param('featureId') featureId: string) {
    return this.service.getStats({ featureId });
  }

  @Get('tests/:testId/issues/stats')
  @ApiOperation({ summary: 'Aggregated issue stats for a test case' })
  async testStats(@Param('testId') testDefinitionId: string) {
    return this.service.getStats({ testDefinitionId });
  }

  // ─── GET ONE ─────────────────────────────────────────────────────────────────

  @Get('issues/:id')
  @ApiOperation({ summary: 'Get a single issue with history and comments' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // ─── ISSUE VIEWER ────────────────────────────────────────────────────────────

  @Get('issues/:id/viewer')
  @ApiOperation({ summary: 'Get issue for viewer (with access check, views, and project info)' })
  async findOneForViewer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOneForViewer(id, user.sub);
  }

  @Post('issues/:id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a view for an issue' })
  async recordView(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.recordView(id, user.sub);
  }

  @Get('issues/:id/views')
  @ApiOperation({ summary: 'Get viewers list for an issue' })
  async getViews(@Param('id') id: string) {
    return this.service.getViews(id);
  }

  @Get('issues/:id/mentionable')
  @ApiOperation({ summary: 'Get mentionable users for an issue (project members + org admins)' })
  async getMentionable(@Param('id') id: string) {
    return this.service.getMentionable(id);
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────────

  @Patch('issues/:id')
  @ApiOperation({ summary: 'Update an issue (title, severity, description, etc.)' })
  async update(@Param('id') id: string, @Body() dto: UpdateIssueDto) {
    return this.service.update(id, dto);
  }

  // ─── CHANGE STATUS ───────────────────────────────────────────────────────────

  @Post('issues/:id/status')
  @ApiOperation({ summary: 'Change the status of an issue (creates history entry)' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.changeStatus(id, dto, user.sub);
  }

  // ─── COMMENTS ────────────────────────────────────────────────────────────────

  @Post('issues/:id/comments')
  @ApiOperation({ summary: 'Add a comment to an issue' })
  async addComment(
    @Param('id') issueId: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addComment(issueId, dto, user.sub);
  }

  @Delete('issues/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a comment (own comments only)' })
  async deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.deleteComment(commentId, user.sub);
  }

  // ─── DELETE ──────────────────────────────────────────────────────────────────

  @Delete('issues/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an issue' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }

  @Delete('issues/:id/hard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete an issue (OWNER / ORG_ADMIN)' })
  async hardDelete(@Param('id') id: string) {
    await this.service.hardDelete(id);
  }
}
