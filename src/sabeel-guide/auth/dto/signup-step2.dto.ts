import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, IsEnum, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender } from '../entities/guide.entity';

export class SignupStep2Dto {
  @ApiProperty({ description: 'First name', example: 'Mohammed' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Alami' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(50, { message: 'Last name cannot exceed 50 characters' })
  lastName: string;

  @ApiProperty({ description: 'Date of birth', example: '1990-01-01' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: Gender, description: 'Gender' })
  @IsEnum(Gender, { message: 'Invalid gender value' })
  gender: Gender;

  @ApiProperty({ description: 'Nationality', example: 'Moroccan' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(50, { message: 'Nationality cannot exceed 50 characters' })
  nationality: string;

  @ApiProperty({ description: 'Country of residence', example: 'Morocco' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(50, { message: 'Country of residence cannot exceed 50 characters' })
  countryOfResidence: string;

  @ApiProperty({ description: 'Full address', example: '123 Rue Mohammed V, Casablanca, Morocco' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(200, { message: 'Address cannot exceed 200 characters' })
  fullAddress: string;
}
