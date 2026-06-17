import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min, IsArray, ArrayMaxSize, IsUUID, ValidateIf } from 'class-validator';
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
