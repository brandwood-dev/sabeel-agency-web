import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { User } from '../sabeel/auth/entities/user.entity';
import { NotificationsGateway } from '../common/gateways/notifications.gateway';
import { CreateReviewDto } from './dto/create-review.dto';
import { Review, ReviewTargetType } from './entities/review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AdminAgenceUser)
    private readonly agencyRepository: Repository<AdminAgenceUser>,
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  private normalizeTargetType(type: ReviewTargetType) {
    if (type === ReviewTargetType.AGENCY || type === ReviewTargetType.GUIDE) return type;
    throw new BadRequestException('Invalid targetType');
  }

  private async assertTargetExists(targetType: ReviewTargetType, targetId: string) {
    if (targetType === ReviewTargetType.AGENCY) {
      const agency = await this.agencyRepository.findOne({ where: { id: targetId } });
      if (!agency) throw new NotFoundException('Agency not found');
      return;
    }
    const guide = await this.guideRepository.findOne({ where: { id: targetId } });
    if (!guide) throw new NotFoundException('Guide not found');
  }

  async createReview(currentUser: { userId: string }, dto: CreateReviewDto) {
    const targetType = this.normalizeTargetType(dto.targetType);
    await this.assertTargetExists(targetType, dto.targetId);

    const author = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!author) {
      throw new NotFoundException('User not found');
    }

    // Upsert by unique (authorUserId, targetType, targetId)
    const existing = await this.reviewRepository.findOne({
      where: {
        authorUserId: currentUser.userId,
        targetType,
        targetId: dto.targetId,
      },
    });

    const review = existing
      ? Object.assign(existing, { rating: dto.rating, comment: dto.comment })
      : this.reviewRepository.create({
          authorUserId: currentUser.userId,
          targetType,
          targetId: dto.targetId,
          rating: dto.rating,
          comment: dto.comment,
        });

    const saved = await this.reviewRepository.save(review);
    const payloadReview = await this.getReviewById(saved.id);

    if (targetType === ReviewTargetType.GUIDE) {
      const authorName = `${payloadReview?.author?.firstName || ''} ${payloadReview?.author?.lastName || ''}`.trim();
      const comment = String(payloadReview?.comment || '').trim();
      const preview = comment.length > 140 ? `${comment.slice(0, 140)}...` : comment;

      this.notificationsGateway.sendNotification(dto.targetId, {
        title: 'Nouvel avis',
        body: `${authorName || 'Un pèlerin'}: ${preview || 'a laissé un avis.'}`,
        data: {
          type: 'review',
          targetType: ReviewTargetType.GUIDE,
          targetId: dto.targetId,
          reviewId: payloadReview?.id,
          authorName,
          comment,
          rating: payloadReview?.rating,
          createdAt: payloadReview?.createdAt,
        },
      });
    }

    return {
      review: payloadReview,
    };
  }

  async getReviewById(id: string) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: { author: true },
    });
    if (!review) throw new NotFoundException('Review not found');

    return {
      id: review.id,
      targetType: review.targetType,
      targetId: review.targetId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      author: {
        id: review.author?.id || review.authorUserId,
        firstName: (review.author as any)?.firstName || '',
        lastName: (review.author as any)?.lastName || '',
        photo: (review.author as any)?.photo || null,
      },
    };
  }

  async listByTarget(targetTypeRaw: ReviewTargetType, targetId: string) {
    const targetType = this.normalizeTargetType(targetTypeRaw);
    await this.assertTargetExists(targetType, targetId);

    const reviews = await this.reviewRepository.find({
      where: { targetType, targetId },
      relations: { author: true },
      order: { createdAt: 'DESC' },
    });

    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        author: {
          id: r.author?.id || r.authorUserId,
          firstName: (r.author as any)?.firstName || '',
          lastName: (r.author as any)?.lastName || '',
          photo: (r.author as any)?.photo || null,
        },
      })),
    };
  }

  async getSummaryByTarget(targetTypeRaw: ReviewTargetType, targetId: string) {
    const targetType = this.normalizeTargetType(targetTypeRaw);
    await this.assertTargetExists(targetType, targetId);

    const raw = await this.reviewRepository
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.targetType = :targetType', { targetType })
      .andWhere('r.targetId = :targetId', { targetId })
      .getRawOne<{ avg: string | null; count: string | null }>();

    const avg = raw?.avg ?? null;
    const count = raw?.count ?? null;

    return {
      targetType,
      targetId,
      averageRating: avg ? Number(parseFloat(avg).toFixed(2)) : 0,
      reviewsCount: count ? Number(count) : 0,
    };
  }

  async listMyReviews(currentUser: { userId: string }) {
    const reviews = await this.reviewRepository.find({
      where: { authorUserId: currentUser.userId },
      order: { createdAt: 'DESC' },
    });

    const agencyTargetIds = Array.from(
      new Set(reviews.filter((r) => r.targetType === ReviewTargetType.AGENCY).map((r) => r.targetId)),
    );
    const guideTargetIds = Array.from(
      new Set(reviews.filter((r) => r.targetType === ReviewTargetType.GUIDE).map((r) => r.targetId)),
    );

    const [agencies, guides] = await Promise.all([
      agencyTargetIds.length
        ? this.agencyRepository.find({ where: agencyTargetIds.map((id) => ({ id })) })
        : Promise.resolve([] as AdminAgenceUser[]),
      guideTargetIds.length
        ? this.guideRepository.find({ where: guideTargetIds.map((id) => ({ id })) })
        : Promise.resolve([] as Guide[]),
    ]);

    const agencyNameById = new Map(agencies.map((a) => [a.id, a.agencyName || a.fullName || 'Agence']));
    const guideNameById = new Map(
      guides.map((g) => [g.id, `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'Guide']),
    );

    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        targetName:
          r.targetType === ReviewTargetType.AGENCY
            ? agencyNameById.get(r.targetId) || 'Agence'
            : guideNameById.get(r.targetId) || 'Guide',
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    };
  }

  async feed(options?: { targetType?: ReviewTargetType; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);

    const qb = this.reviewRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.author', 'author')
      .orderBy('r.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (options?.targetType) {
      qb.andWhere('r.targetType = :targetType', { targetType: this.normalizeTargetType(options.targetType) });
    }

    const reviews = await qb.getMany();

    const agencyTargetIds = Array.from(new Set(reviews.filter(r => r.targetType === ReviewTargetType.AGENCY).map(r => r.targetId)));
    const guideTargetIds = Array.from(new Set(reviews.filter(r => r.targetType === ReviewTargetType.GUIDE).map(r => r.targetId)));

    const [agencies, guides] = await Promise.all([
      agencyTargetIds.length ? this.agencyRepository.find({ where: agencyTargetIds.map(id => ({ id })) }) : Promise.resolve([] as AdminAgenceUser[]),
      guideTargetIds.length ? this.guideRepository.find({ where: guideTargetIds.map(id => ({ id })) }) : Promise.resolve([] as Guide[]),
    ]);

    const agencyNameById = new Map(agencies.map(a => [a.id, a.agencyName || a.fullName || 'Agence']));
    const guideNameById = new Map(guides.map(g => [g.id, `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'Guide']));

    return {
      reviews: reviews.map((r) => {
        const targetName = r.targetType === ReviewTargetType.AGENCY
          ? agencyNameById.get(r.targetId) || 'Agence'
          : guideNameById.get(r.targetId) || 'Guide';

        return {
          id: r.id,
          targetType: r.targetType,
          targetId: r.targetId,
          targetName,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          author: {
            id: r.author?.id || r.authorUserId,
            firstName: (r.author as any)?.firstName || '',
            lastName: (r.author as any)?.lastName || '',
            photo: (r.author as any)?.photo || null,
          },
        };
      }),
      limit,
      offset,
    };
  }
}
