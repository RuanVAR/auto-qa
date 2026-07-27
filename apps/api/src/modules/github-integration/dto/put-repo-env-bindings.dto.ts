import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VersionFileFormat, VersionSourceMode } from '@prisma/client';
import { BRANCH } from './link-repo.dto';

export class RepoEnvBindingInputDto {
  @IsUUID()
  environmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(BRANCH, { message: 'branch is not a valid Git branch name' })
  branch!: string;

  @IsOptional()
  @IsEnum(VersionSourceMode)
  versionSource?: VersionSourceMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  versionFilePath?: string;

  @IsOptional()
  @IsEnum(VersionFileFormat)
  versionFileFormat?: VersionFileFormat;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  versionSelector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  componentName?: string;
}

export class PutRepoEnvBindingsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RepoEnvBindingInputDto)
  bindings!: RepoEnvBindingInputDto[];
}
