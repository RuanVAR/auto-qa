import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateCodeDto {
  @ApiProperty({ description: "The target organisation's transfer code", example: 'K7QW2MHT9ZDR' })
  @IsString()
  @Length(4, 64)
  code: string;
}
