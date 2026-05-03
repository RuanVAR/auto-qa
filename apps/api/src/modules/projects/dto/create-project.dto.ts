import { IsString, IsOptional, MinLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(2) name: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]+$/) slug: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
}
