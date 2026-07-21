import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateSelectorHealSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  promotionRuns?: number;
}
