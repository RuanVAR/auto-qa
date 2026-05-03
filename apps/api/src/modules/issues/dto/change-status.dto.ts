import { IsEnum, IsString, IsOptional } from 'class-validator';
import { IssueStatus } from '@prisma/client';

export class ChangeStatusDto {
  @IsEnum(IssueStatus)
  status!: IssueStatus;

  @IsString()
  @IsOptional()
  note?: string;
}
