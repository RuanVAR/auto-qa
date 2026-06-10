import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TestFailureCategory } from '@prisma/client';

export enum QuickMarkStatus {
  PASSED = 'PASSED',
  FAILED = 'FAILED',
}

export class QuickMarkDto {
  @IsEnum(QuickMarkStatus)
  status!: QuickMarkStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsString()
  @IsOptional()
  environmentId?: string;

  /** Structured failure reason — captured when status=FAILED. */
  @IsEnum(TestFailureCategory)
  @IsOptional()
  failureCategory?: TestFailureCategory;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  failureNote?: string;

  /** Named manual Test Run (TestRunSession) this mark belongs to, if any. */
  @IsString()
  @IsOptional()
  testRunSessionId?: string;
}
