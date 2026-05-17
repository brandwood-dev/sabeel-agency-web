import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginAdminAgenceDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
