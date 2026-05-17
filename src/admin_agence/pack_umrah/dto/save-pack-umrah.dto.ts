import { IsArray, IsBoolean, IsNumberString, IsOptional, IsString } from 'class-validator';

export class SavePackUmrahDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsNumberString()
  price?: string;

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
  lat?: number;

  @IsOptional()
  lng?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

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
  @IsArray()
  program?: { day: string; title: string; description: string }[];

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
