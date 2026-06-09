import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for /auth/refresh and /auth/logout — just the refresh token. Optional at
 * the DTO level so it serves both: /logout (token genuinely optional) and
 * /refresh (the handler still enforces presence and returns its existing 403).
 * Replaces the inline `{ refreshToken }` object types so these security-
 * sensitive endpoints are validated, and forbidNonWhitelisted rejects any other
 * field on the wire.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional() @IsOptional() @IsString() refreshToken?: string;
}
