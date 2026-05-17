import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GuideRole } from '../entities/guide.entity';

export class SwitchRoleDto {
  @ApiProperty({ enum: GuideRole, description: 'Target role to switch to' })
  @IsEnum(GuideRole, { message: 'Invalid role' })
  targetRole: GuideRole;
}
