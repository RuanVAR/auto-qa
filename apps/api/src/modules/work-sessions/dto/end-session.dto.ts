import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EndSessionDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  reason?: string;
}
