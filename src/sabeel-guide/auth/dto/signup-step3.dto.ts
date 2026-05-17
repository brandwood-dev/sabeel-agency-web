import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, IsBoolean, IsEnum, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export enum DocumentType {
  ID_CARD = 'id_card',
  PASSPORT = 'passport',
}

export class SignupStep3Dto {
  @ApiProperty({ enum: DocumentType, description: 'Document type' })
  @IsEnum(DocumentType, { message: 'Invalid document type' })
  documentType: DocumentType;

  @ApiProperty({ description: 'Document number', example: 'AB123456' })
  @IsString()
  @Transform(({ value }) => value?.trim().toUpperCase())
  @MaxLength(20, { message: 'Document number cannot exceed 20 characters' })
  documentNumber: string;

  @ApiProperty({ description: 'Issuing country', example: 'Morocco' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(50, { message: 'Issuing country cannot exceed 50 characters' })
  issuingCountry: string;

  @ApiProperty({ description: 'Document expiry date', example: '2025-12-31' })
  @IsDateString()
  documentExpiryDate: string;

  @ApiProperty({ description: 'Accept terms and conditions' })
  @IsBoolean()
  acceptTerms: boolean;

  @ApiProperty({ description: 'Accept privacy policy' })
  @IsBoolean()
  acceptPrivacyPolicy: boolean;
}
