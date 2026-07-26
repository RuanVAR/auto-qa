import { ApiPropertyOptional } from '@nestjs/swagger';
import { RepoRole } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BRANCH } from './link-repo.dto';

export class UpdateRepoDto {
  @ApiPropertyOptional({ enum: RepoRole })
  @IsOptional()
  @IsEnum(RepoRole)
  role?: RepoRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(BRANCH, { message: 'defaultBranch is not a valid Git branch name' })
  defaultBranch?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  includeGlobs?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  excludeGlobs?: string[];
}
