import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { IssueType, IssueSeverity, IssueStatus } from '@prisma/client';

export class ListIssuesDto {
  @IsEnum(IssueStatus)
  @IsOptional()
  status?: IssueStatus;

  @IsEnum(IssueType)
  @IsOptional()
  type?: IssueType;

  @IsEnum(IssueSeverity)
  @IsOptional()
  severity?: IssueSeverity;

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
  assignedToId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
