import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { NotificationType, NotificationCategory } from '@prisma/client';

export class CreateNotificationDto {
  @IsString()
  userId: string;

  @IsString()
  orgId: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsString()
  @IsOptional()
  actionUrl?: string;

  @IsString()
  @IsOptional()
  actionLabel?: string;

  @IsString()
  @IsOptional()
  secondaryActionUrl?: string;

  @IsString()
  @IsOptional()
  secondaryActionLabel?: string;

  @IsOptional()
  meta?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  dedupeKey?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
