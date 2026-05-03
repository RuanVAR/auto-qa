import { IsEnum, IsOptional, IsString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkStepStatusDto {
  @ApiProperty({ enum: ['PASSED', 'FAILED'] })
  @IsEnum(['PASSED', 'FAILED'])
  status: 'PASSED' | 'FAILED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}
