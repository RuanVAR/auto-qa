import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeatureDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) order?: number;
  /**
   * Opt-in flag for automated test execution on this feature. Defaults to
   * false at the DB level — set true to allow AUTOMATED solo runs, Preview
   * runs, and AUTOMATED feature runs. See FeaturePage Settings tab.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() automatedTestingEnabled?: boolean;
}
