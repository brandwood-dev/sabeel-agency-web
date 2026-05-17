import { IsArray, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { AgencyGuideStatus } from '../entities/guide.entity';

export class SaveAgencyGuideDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  cinPassport?: string;

  @IsOptional()
  @IsArray()
  languages?: string[];

  @IsOptional()
  @IsString()
  experience?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsEnum(AgencyGuideStatus)
  status?: AgencyGuideStatus;
}
