import { IsEmail, IsString, MinLength, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export class SignupStep1Dto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  firstName: string;

  @IsString()
  @MinLength(3)
  lastName: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  confirmPassword?: string;

  @IsEnum(['pelerin', 'accompagnant'])
  @IsOptional()
  role?: string;

  @IsBoolean()
  @IsOptional()
  hasAcceptedTerms?: boolean;

  @IsBoolean()
  @IsOptional()
  hasAcceptedPrivacyPolicy?: boolean;
}

