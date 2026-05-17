import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { User } from '../sabeel/auth/entities/user.entity';
import { Review } from './entities/review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [TypeOrmModule.forFeature([Review, User, AdminAgenceUser, Guide])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
