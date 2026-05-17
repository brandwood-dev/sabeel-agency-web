import { IsEnum, IsInt, IsString, Max, Min } from 'class-validator';
import { ReviewTargetType } from '../entities/review.entity';

export class CreateReviewDto {
  @IsEnum(ReviewTargetType)
  targetType: ReviewTargetType;

  @IsString()
  targetId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  comment: string;
}
