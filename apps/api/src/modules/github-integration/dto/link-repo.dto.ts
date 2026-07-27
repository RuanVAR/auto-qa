import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepoRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const REPO_PART = /^[A-Za-z0-9_.-]+$/;
const BRANCH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\s~^:?*[\]\\]+(?<!\/)$/;

export class LinkRepoDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(REPO_PART)
  repoOwner: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(REPO_PART)
  repoName: string;

  @ApiPropertyOptional({ enum: RepoRole })
  @IsOptional()
  @IsEnum(RepoRole)
  role?: RepoRole;

  @ApiPropertyOptional({ default: 'main' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(BRANCH, { message: 'defaultBranch is not a valid Git branch name' })
  defaultBranch?: string;
}

export { BRANCH };
