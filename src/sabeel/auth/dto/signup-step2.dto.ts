import { IsString, IsEnum, IsOptional } from 'class-validator';

export class SignupStep2Dto {
  @IsOptional()
  dateOfBirth: string | Date;

  @IsEnum(['male', 'female', 'other'])
  gender: string;

  @IsString()
  nationality: string;

  @IsString()
  country: string;

  @IsString()
  city: string;

  @IsString()
  address: string;
}
