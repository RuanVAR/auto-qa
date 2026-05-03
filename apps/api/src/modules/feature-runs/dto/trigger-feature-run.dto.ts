import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TriggerFeatureRunDto {
  @ApiPropertyOptional() @IsOptional() @IsString() environmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() versionId?: string;
  @ApiPropertyOptional({ enum: ['AUTOMATED', 'MANUAL'] })
  @IsOptional() @IsEnum(['AUTOMATED', 'MANUAL']) runMode?: 'AUTOMATED' | 'MANUAL';

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
}
