import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class ReorderFeaturesDto {
  /** Feature ids in the desired top-to-bottom order. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIds!: string[];
}
