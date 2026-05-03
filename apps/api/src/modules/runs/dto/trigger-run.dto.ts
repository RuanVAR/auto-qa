import { IsString, IsOptional, IsIn, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunMode } from '@prisma/client';
export class TriggerRunDto {
  @ApiProperty() @IsString() environmentId: string;
  @ApiProperty() @IsString() testDefinitionId: string;
  @ApiPropertyOptional({ enum: RunMode, default: RunMode.AUTOMATED, description: 'AUTOMATED = Playwright executes steps. MANUAL = engineer executes steps via checklist.' })
  @IsEnum(RunMode) @IsOptional() runMode?: RunMode;
  @ApiPropertyOptional({ enum: ['manual','scheduled','api','ci'] }) @IsIn(['manual','scheduled','api','ci']) @IsOptional() trigger?: string;
  @ApiPropertyOptional() @IsOptional() metadata?: Record<string, unknown>;
}
