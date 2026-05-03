import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConfigDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) key!: string;
  @ApiProperty() @IsString() @IsNotEmpty() value!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSecret?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
}
