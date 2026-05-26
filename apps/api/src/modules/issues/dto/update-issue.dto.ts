import { IsString, IsEnum, IsOptional, IsArray, MaxLength } from 'class-validator';
import { IssueSeverity, TestFailureCategory } from '@prisma/client';

export class UpdateIssueDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsEnum(IssueSeverity)
  @IsOptional()
  severity?: IssueSeverity;

  /** Override the root-cause classification — see CreateIssueDto.category. */
  @IsEnum(TestFailureCategory)
  @IsOptional()
  category?: TestFailureCategory;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  stepsToReproduce?: string;

  @IsString()
  @IsOptional()
  expectedBehaviour?: string;

  @IsString()
  @IsOptional()
  actualBehaviour?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  screenshotUrls?: string[];

  @IsString()
  @IsOptional()
  recordingUrl?: string;

  @IsString()
  @IsOptional()
  assignedToId?: string;
}
