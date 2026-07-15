import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TriggerFeatureRunDto {
  @ApiPropertyOptional() @IsOptional() @IsString() environmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() versionId?: string;
  @ApiPropertyOptional({ enum: ['AUTOMATED', 'MANUAL'] })
  @IsOptional() @IsEnum(['AUTOMATED', 'MANUAL']) runMode?: 'AUTOMATED' | 'MANUAL';

  /**
   * How the run started — stamped on the FeatureRun + child TestRuns so
   * history distinguishes user-clicked runs from scheduled/API/CI ones.
   * PAT/REST callers should pass 'api' or 'ci'; the scheduler passes
   * 'scheduled'. Defaults to 'manual'.
   */
  @ApiPropertyOptional({ enum: ['manual', 'scheduled', 'api', 'ci', 'promotion'] })
  @IsOptional() @IsEnum(['manual', 'scheduled', 'api', 'ci', 'promotion'])
  trigger?: 'manual' | 'scheduled' | 'api' | 'ci' | 'promotion';

  // Optional: start the feature run from this test definition instead of the first.
  // Tests before it are skipped (no TestRun record created). Used by "Start From Here"
  // when a tester wants to resume from a specific point after switching modes.
  @ApiPropertyOptional() @IsOptional() @IsString() startFromTestDefinitionId?: string;

  /**
   * Bypass the "you already have an active manual session" guard. Used
   * after the client confirms an "End A and start B" intent — the server
   * still expects the client to have called `abandon` on the previous run
   * first, so this is just an explicit acknowledgement that the conflict
   * has been resolved.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowConcurrent?: boolean;

  /**
   * When started inside a NAMED manual Test Run (TestRunSession), the umbrella
   * run's id — stamped onto the FeatureRun + every child TestRun so the run
   * aggregates results across features.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() testRunSessionId?: string;

  /**
   * Snapshot-publish the feature's current draft before running, if it has
   * unpublished changes (or was never published). Used by the in-run
   * "next feature" hand-off so jumping to a draft feature tests its latest
   * state without the tester stopping to publish it manually.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPublish?: boolean;
}
