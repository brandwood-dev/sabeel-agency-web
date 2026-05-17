import { Type } from 'class-transformer';
import { IsBooleanString, IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty()
  packId: string;

  @IsOptional()
  @IsString()
  reservationDate?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;

  @IsOptional()
  @IsString()
  userPhone?: string;

  @IsOptional()
  @IsNumberString()
  userAge?: string;

  @Type(() => Number)
  pilgrimCount: number;

  @IsOptional()
  @IsBooleanString()
  hasDisease?: string;

  @IsOptional()
  @IsString()
  medications?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  specialRequests?: string;

  @IsOptional()
  @IsString()
  paymentType?: string;

  @IsOptional()
  @IsString()
  paymentMode?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  totalPrice?: string;

  @IsOptional()
  @IsNumberString()
  advanceAmount?: string;

  @IsOptional()
  @IsNumberString()
  remainingAmount?: string;

  @IsOptional()
  @IsNumberString()
  appCommissionRate?: string;

  @IsOptional()
  @IsNumberString()
  appCommissionAmount?: string;
}

export class CreateGuideReservationDto {
  @IsString()
  @IsNotEmpty()
  guideId: string;

  @IsOptional()
  @IsString()
  reservationDate?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;

  @IsOptional()
  @IsString()
  userPhone?: string;

  @IsOptional()
  @IsNumberString()
  userAge?: string;

  @Type(() => Number)
  pilgrimCount: number;

  @IsOptional()
  @IsBooleanString()
  hasDisease?: string;

  @IsOptional()
  @IsString()
  medications?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  specialRequests?: string;

  @IsOptional()
  @IsString()
  paymentType?: string;

  @IsOptional()
  @IsString()
  paymentMode?: string;
}
