import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewTransferDto {
  @ApiPropertyOptional({ description: 'Note shown to the sending organisation' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'On accept: who owns the project if the current owner is not in your organisation. ' +
      'Must be a member of your organisation. Defaults to the accepting admin.',
  })
  @IsUUID()
  @IsOptional()
  newOwnerId?: string;
}
