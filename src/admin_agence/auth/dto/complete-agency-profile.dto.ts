import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CompleteAgencyProfileDto {
  @IsOptional()
  @IsString()
  agencyType?: string;

  @IsOptional()
  @IsString()
  responsibleName?: string;

  @IsOptional()
  @IsString()
  responsibleTitle?: string;

  @IsOptional()
  @IsString()
  contractDuration?: string;

  @IsOptional()
  @IsString()
  documentLabels?: string;

  @IsOptional()
  @IsString()
  contractFileName?: string;

  @IsString()
  @IsNotEmpty()
  submissionStatus: string;
}
