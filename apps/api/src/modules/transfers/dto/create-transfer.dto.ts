import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferDto {
  @ApiProperty({ description: "The target organisation's transfer code", example: 'K7QW2MHT9ZDR' })
  @IsString()
  @Length(4, 64)
  code: string;

  @ApiPropertyOptional({ description: "Note shown to the target org's admins" })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;
}
