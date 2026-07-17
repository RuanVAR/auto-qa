import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAcceptsTransfersDto {
  @ApiProperty({ description: 'Whether this organisation accepts incoming project transfers' })
  @IsBoolean()
  acceptsTransfers: boolean;
}
