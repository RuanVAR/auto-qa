import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
