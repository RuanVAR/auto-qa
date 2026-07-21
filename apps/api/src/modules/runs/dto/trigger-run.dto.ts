import { IsString, IsOptional, IsIn, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunMode } from '@prisma/client';
export class TriggerRunDto {
  @ApiProperty() @IsString() environmentId: string;
  @ApiProperty() @IsString() testDefinitionId: string;
  @ApiPropertyOptional({ enum: RunMode, default: RunMode.AUTOMATED, description: 'AUTOMATED = Playwright executes steps. MANUAL = engineer executes steps via checklist.' })
  @IsEnum(RunMode) @IsOptional() runMode?: RunMode;
  @ApiPropertyOptional({ enum: ['manual','scheduled','api','ci','preview'] })
  @IsIn(['manual','scheduled','api','ci','preview']) @IsOptional() trigger?: string;
  @ApiPropertyOptional() @IsOptional() metadata?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Immutable source revision for CI-triggered runs' })
  @IsOptional() @IsString() commitSha?: string;
  @ApiPropertyOptional({ description: 'Source branch for CI-triggered runs' })
  @IsOptional() @IsString() branch?: string;
  /**
   * Ephemeral debug run — when true, the resulting TestRun is excluded from
   * history listings, stats, donut counts, pass-rate calculations, and the
   * live per-test badges. The tester still sees it execute via LiveRunModal
   * because the modal watches by id. Cleaning up these rows is a future
   * concern (cron sweep over isPreview rows older than N hours).
   */
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPreview?: boolean;
}
