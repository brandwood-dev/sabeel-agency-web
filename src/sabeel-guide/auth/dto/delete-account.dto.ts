import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({ description: 'The current password to confirm deletion' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
