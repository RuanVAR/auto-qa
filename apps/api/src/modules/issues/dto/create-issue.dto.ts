import { IsString, IsEnum, IsOptional, IsArray, IsNotEmpty, MaxLength } from 'class-validator';
import { IssueType, IssueSeverity, TestFailureCategory } from '@prisma/client';

export class CreateIssueDto {
  @IsEnum(IssueType)
  type!: IssueType;

  /**
   * Root-cause classification — re-uses the TestFailureCategory enum so
   * bug-cause analytics line up with test-failure-cause analytics on the
   * same donut. Optional in transit (service defaults to FUNCTIONALITY).
   */
  @IsEnum(TestFailureCategory)
  @IsOptional()
  category?: TestFailureCategory;

  @IsEnum(IssueSeverity)
  @IsOptional()
  severity?: IssueSeverity;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

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

  // Hierarchy context — all optional
  @IsString()
  @IsOptional()
  moduleId?: string;

  @IsString()
  @IsOptional()
  featureId?: string;

  @IsString()
  @IsOptional()
  testDefinitionId?: string;

  @IsString()
  @IsOptional()
  testRunId?: string;

  @IsString()
  @IsOptional()
  runStepId?: string;

  @IsString()
  @IsOptional()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  recordingUrl?: string;
}
