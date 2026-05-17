import { IsString, IsOptional } from 'class-validator';

export class SignupStep3Dto {
  @IsOptional()
  @IsString()
  cinOrPassport?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsString()
  qrId?: string;
}
