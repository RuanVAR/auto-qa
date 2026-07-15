import { IsString, IsOptional, MinLength, Matches, IsUrl, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(2) name: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]+$/) slug: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;

  /** Outbound webhook target — POSTed a signed feature_run.completed event
   *  when a feature run finishes. Empty string clears it. */
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.webhookUrl !== '')
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  webhookUrl?: string;

  /** HMAC-SHA256 signing secret for the webhook (encrypted at rest).
   *  Write-only — never returned by the API. */
  @ApiPropertyOptional() @IsString() @IsOptional() webhookSecret?: string;
}
