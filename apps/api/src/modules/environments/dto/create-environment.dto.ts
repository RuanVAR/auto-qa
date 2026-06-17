import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnvironmentType } from '@prisma/client';

export class CreateEnvironmentDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: EnvironmentType }) @IsEnum(EnvironmentType) type: EnvironmentType;
  @ApiProperty() @IsString() baseUrl: string;
  @ApiPropertyOptional({ default: true, description: 'Set false if the app blocks iframe embedding (X-Frame-Options / CSP). Manual mode will show "Open in new tab" instead.' })
  @IsBoolean() @IsOptional() embedAllowed?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Set true to mark this environment as a legal target for automated (Playwright) runs. Automated runs are blocked unless their target env has this enabled.' })
  @IsBoolean() @IsOptional() supportsAutomation?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsOptional() headers?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() variables?: Record<string, string>;
  @ApiPropertyOptional({ description: 'Display order in pickers and dropdowns (lower = first). Defaults to 0.' })
  @IsInt() @Min(0) @IsOptional() order?: number;
}
