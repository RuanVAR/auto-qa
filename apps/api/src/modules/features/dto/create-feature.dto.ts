import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsInt, Min, Max, IsArray, ArrayMaxSize, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeatureDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  // Feature descriptions hold full user stories / acceptance-criteria markdown
  // (often AI-generated or ClickUp-synced) which routinely exceed 1k chars.
  // The DB column is unbounded text; 20k is a generous guard against abuse.
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) order?: number;
  // Automated-run fan-out budget (docs/plan/06-PHASE-4-SCALE.md §4.1). Unset
  // = DEFAULT_FEATURE_CONCURRENCY; set to 1 for tests that share state (a
  // test account, a server-side session) and must run one at a time.
  @ApiPropertyOptional({ nullable: true, description: 'Automated-run fan-out budget. Unset = platform default; 1 = tests run serially.' })
  @IsOptional()
  @ValidateIf((o) => o.concurrency !== null)
  @IsInt()
  @Min(1)
  @Max(20)
  concurrency?: number | null;
  // De-parallelising retry ladder (docs/plan/06-PHASE-4-SCALE.md §4.2) —
  // default on; an explicit opt-out for teams that would rather see a raw
  // first-attempt failure immediately instead of an eventual-pass diagnosis.
  @ApiPropertyOptional() @IsOptional() @IsBoolean() retryLadderEnabled?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tags?: string[];
  // Automation availability is env-driven (Environment.supportsAutomation);
  // there is no per-feature automation flag.
  /**
   * Optional assigned developer (a member of the feature's project). Pass a
   * user id to assign, or `null` to unassign. ValidateIf lets explicit null
   * through while still validating a provided id is a UUID.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.developerId !== null)
  @IsUUID()
  developerId?: string | null;
}
