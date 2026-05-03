import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class GenerateTestDto {
  @ApiProperty({ example: 'Create a login smoke test for the admin portal' })
  @IsString() @MinLength(10) prompt: string;
}
