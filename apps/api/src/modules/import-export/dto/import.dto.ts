import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportDto {
  @IsOptional()
  @IsUUID()
  targetModuleId?: string;

  @IsOptional()
  @IsUUID()
  targetFeatureId?: string;

  // The envelope JSON is passed as the request body directly — validated in service
  [key: string]: unknown;
}
