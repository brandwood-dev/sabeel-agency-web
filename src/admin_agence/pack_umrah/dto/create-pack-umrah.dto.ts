import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsEnum } from 'class-validator';
import { PackUmrahStatus } from '../entities/pack-umrah.entity';

export class CreatePackUmrahDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  departureDate?: string;

  @IsOptional()
  @IsString()
  arrivalDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  hotelMekkah?: string;

  @IsOptional()
  @IsString()
  hotelMekkahStars?: string;

  @IsOptional()
  @IsString()
  hotelMedina?: string;

  @IsOptional()
  @IsString()
  hotelMedinaStars?: string;

  @IsOptional()
  @IsBoolean()
  volDirect?: boolean;

  @IsOptional()
  @IsBoolean()
  hasEscale?: boolean;

  @IsOptional()
  @IsString()
  escaleDetails?: string;

  @IsOptional()
  @IsBoolean()
  visaInclus?: boolean;

  @IsOptional()
  @IsBoolean()
  transfert?: boolean;

  @IsOptional()
  @IsString()
  guideName?: string;

  @IsOptional()
  @IsArray()
  guideLanguages?: string[];

  @IsOptional()
  @IsString()
  agencyAddress?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsString()
  priceSharedRoom?: string;

  @IsOptional()
  @IsString()
  priceIndividualRoom?: string;

  @IsOptional()
  @IsString()
  priceAdult?: string;

  @IsOptional()
  @IsString()
  priceChild?: string;

  @IsOptional()
  @IsString()
  priceSenior?: string;

  @IsOptional()
  @IsArray()
  hotelMekkahImages?: string[];

  @IsOptional()
  @IsArray()
  hotelMedinaImages?: string[];

  @IsOptional()
  program?: { day: string; title: string; description: string }[];

  @IsOptional()
  @IsEnum(PackUmrahStatus)
  status?: PackUmrahStatus;
}
