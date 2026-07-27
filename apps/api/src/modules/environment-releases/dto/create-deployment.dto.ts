import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EnvironmentReleaseStatus } from '@prisma/client';

function upper(value: unknown): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export class DeploymentComponentDto {
  @IsOptional()
  @IsUUID()
  repoId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  commitSha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  artifactDigest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  manifestPath?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateDeploymentDto {
  @Transform(({ value }: { value: unknown }) => upper(value))
  @IsEnum(EnvironmentReleaseStatus)
  status!: EnvironmentReleaseStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  releaseVersion?: string;

  @IsOptional()
  @IsUUID()
  repoId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  componentName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  commitSha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  artifactDigest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalDeploymentId?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  pipelineUrl?: string;

  @IsOptional()
  @IsDateString()
  deployedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DeploymentComponentDto)
  components?: DeploymentComponentDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
