import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessRequestType } from '@prisma/client';

export class CreateAccessRequestDto {
  @ApiProperty({ enum: AccessRequestType })
  @IsEnum(AccessRequestType)
  type: AccessRequestType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  projectId?: string;
}
