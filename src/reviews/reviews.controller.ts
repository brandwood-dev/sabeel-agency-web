import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewTargetType } from './entities/review.entity';
import { ReviewsService } from './reviews.service';

@Controller('sabeel/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: { userId: string }, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createReview(user, dto);
  }

  @Get('target')
  async listByTarget(
    @Query('targetType') targetType: ReviewTargetType,
    @Query('targetId') targetId: string,
  ) {
    return this.reviewsService.listByTarget(targetType, targetId);
  }

  @Get('target/summary')
  async summaryByTarget(
    @Query('targetType') targetType: ReviewTargetType,
    @Query('targetId') targetId: string,
  ) {
    return this.reviewsService.getSummaryByTarget(targetType, targetId);
  }

  @Get('feed')
  async feed(
    @Query('targetType') targetType?: ReviewTargetType,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reviewsService.feed({
      targetType,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async myReviews(@CurrentUser() user: { userId: string }) {
    return this.reviewsService.listMyReviews(user);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.reviewsService.getReviewById(id);
  }
}
