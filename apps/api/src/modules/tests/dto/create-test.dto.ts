import { IsString, IsOptional, IsArray, IsBoolean, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TestCaseType } from '@prisma/client';
import { IsStepArray } from './steps.validator';

export class CreateTestDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: TestCaseType }) @IsEnum(TestCaseType) @IsOptional() type?: TestCaseType;
  @ApiPropertyOptional({ type: [String] }) @IsArray() @IsOptional() tags?: string[];
  @ApiProperty({ type: [Object] }) @IsArray() @IsStepArray() steps!: object[];
  @ApiPropertyOptional() @IsOptional() config?: object;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isAiDraft?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() featureId?: string;
}
