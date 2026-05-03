import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewAccessRequestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  action: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'OrgRole or ProjectRole to grant on approval' })
  @IsString()
  @IsOptional()
  grantedRole?: string;

  @ApiPropertyOptional({ description: 'Optional note shown to requester' })
  @IsString()
  @IsOptional()
  reviewerNote?: string;
}
