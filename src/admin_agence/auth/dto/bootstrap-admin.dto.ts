import { IsEmail, IsString, MinLength } from 'class-validator';

export class BootstrapAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  fullName: string;

  @IsString()
  phoneNumber: string;
}
