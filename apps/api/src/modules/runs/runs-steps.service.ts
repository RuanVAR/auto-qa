import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StepStatus, RunStatus, TriageBucket } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MarkStepStatusDto } from './dto/mark-step-status.dto';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';

export class PatchStepDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  jiraIssueKey?: string;
}

@Injectable()
export class RunStepsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FeatureRunsService))
    private readonly featureRunsService: FeatureRunsService,
  ) {}

  async addNotes(runId: string, stepId: string, notes: string) {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId },
    });
    if (!step) throw new NotFoundException('Step not found');
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: { notes },
    });
  }

  async setJiraKey(runId: string, stepId: string, jiraIssueKey: string) {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId },
    });
    if (!step) throw new NotFoundException('Step not found');
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: { jiraIssueKey },
    });
  }

  async setTriageBucket(runId: string, stepId: string, triageBucket: TriageBucket | null) {
    const step = await this.prisma.runStep.findFirst({ where: { id: stepId, runId } });
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== StepStatus.FAILED) {
      throw new BadRequestException('Only failed steps can be triaged');
    }
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: { triageBucket, triageBucketOverridden: true },
    });
  }

  async muteFailure(runId: string, stepId: string, reason: string, userId: string) {
    const step = await this.prisma.runStep.findFirst({ where: { id: stepId, runId } });
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== StepStatus.FAILED) throw new BadRequestException('Only failed steps can be muted');
    if (!reason.trim()) throw new BadRequestException('A mute reason is required');
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: { resolution: 'MUTED', muteReason: reason.trim(), resolvedAt: new Date(), resolvedById: userId },
    });
  }

  async skipStep(runId: string, stepId: string) {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId },
    });
    if (!step) throw new NotFoundException('Step not found');
    if (
      step.status !== StepStatus.FAILED &&
      step.status !== StepStatus.RUNNING
    ) {
      throw new BadRequestException('Can only skip a failed or running step');
    }
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: { status: StepStatus.SKIPPED, completedAt: new Date() },
    });
  }

  async retryStep(runId: string, stepId: string) {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId },
    });
    if (!step) throw new NotFoundException('Step not found');
    if (step.status !== StepStatus.FAILED) {
      throw new BadRequestException('Can only retry a failed step');
    }
    // Reset to PENDING — the worker will pick it up when run is resumed
    return this.prisma.runStep.update({
      where: { id: stepId },
      data: {
        status: StepStatus.PENDING,
        errorMessage: null,
        completedAt: null,
        duration: null,
      },
    });
  }

  async getStepsForRun(runId: string) {
    return this.prisma.runStep.findMany({
      where: { runId },
      orderBy: { index: 'asc' },
    });
  }

  async markStepStatus(runId: string, stepId: string, dto: MarkStepStatusDto) {
    const existing = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId },
    });
    if (!existing) throw new NotFoundException('Step not found');

    const step = await this.prisma.runStep.update({
      where: { id: stepId },
      data: {
        status: dto.status as StepStatus,
        notes: dto.notes ?? null,
        completedAt: new Date(),
        executedBy: 'MANUAL',
        ...(dto.evidenceUrls !== undefined ? { evidenceUrls: dto.evidenceUrls } : {}),
      },
    });

    // Check if ALL steps in this run are now marked (PASSED or FAILED or SKIPPED)
    const allSteps = await this.prisma.runStep.findMany({ where: { runId } });
    const allDone = allSteps.every(s =>
      ['PASSED', 'FAILED', 'SKIPPED'].includes(s.status),
    );

    if (allDone) {
      const anyFailed = allSteps.some(s => s.status === 'FAILED');
      await this.prisma.testRun.update({
        where: { id: runId },
        data: {
          status: anyFailed ? RunStatus.FAILED : RunStatus.PASSED,
          completedAt: new Date(),
        },
      });
      // Propagate completion to parent FeatureRun (if any)
      await this.featureRunsService.onRunComplete(runId);
    }

    return step;
  }

  async getRunSteps(runId: string) {
    return this.prisma.runStep.findMany({
      where: { runId },
      orderBy: { index: 'asc' },
    });
  }
}
