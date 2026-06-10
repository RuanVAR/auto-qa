import { IsString, IsNotEmpty, IsOptional, IsArray, IsEmail, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTestRunSessionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  /** Feature the run is kicked off from (reports are stored against it). */
  @ApiPropertyOptional() @IsOptional() @IsString() startedFromFeatureId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() environmentId?: string;
}

export class GenerateRunReportDto {
  /** Optional email recipients — the rendered PDF is emailed on generation. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsEmail({}, { each: true })
  recipientEmails?: string[];

  /** Optional free-form note included in the report body. */
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(5000)
  additionalText?: string;
}
