import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GitAuthKind, GitProvider } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpsertGitCredentialDto {
  @ApiProperty({ enum: GitAuthKind })
  @IsEnum(GitAuthKind)
  authKind: GitAuthKind;

  @ApiPropertyOptional({ enum: GitProvider, default: GitProvider.GITHUB })
  @IsOptional()
  @IsEnum(GitProvider)
  provider?: GitProvider;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayLabel?: string;

  @ApiPropertyOptional({ description: 'GitHub Enterprise API base URL, for example https://github.example.com/api/v3' })
  @ValidateIf((value: UpsertGitCredentialDto) => value.baseUrl !== undefined && value.baseUrl !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'appId must be numeric' })
  appId?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32_768)
  privateKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'appInstallationId must be numeric' })
  appInstallationId?: string;
}
