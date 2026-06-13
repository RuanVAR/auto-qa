import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min, IsBoolean, IsArray, ArrayMaxSize, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeatureDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  // Feature descriptions hold full user stories / acceptance-criteria markdown
  // (often AI-generated or ClickUp-synced) which routinely exceed 1k chars.
  // The DB column is unbounded text; 20k is a generous guard against abuse.
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) order?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tags?: string[];
  /**
   * Opt-in flag for automated test execution on this feature. Defaults to
   * false at the DB level — set true to allow AUTOMATED solo runs, Preview
   * runs, and AUTOMATED feature runs. See FeaturePage Settings tab.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() automatedTestingEnabled?: boolean;
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
