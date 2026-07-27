import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmbeddingProvider } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertEmbeddingCredentialDto {
  @ApiProperty({ enum: EmbeddingProvider })
  @IsEnum(EmbeddingProvider)
  provider: EmbeddingProvider;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  apiKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  azureDeployment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  azureApiVersion?: string;
}
