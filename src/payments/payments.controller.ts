import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('connect/status')
  async connectStatus(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.paymentsService.getMyConnectPayoutMethodSummary({ user });
  }

  @Post('topup/create-intent')
  async createTopupIntent(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { amountCents: number; referenceType: string; referenceId: string; idempotencyKey: string },
  ) {
    return this.paymentsService.createTopupPaymentIntent({
      user,
      amountCents: body.amountCents,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('direct/create-intent')
  async createDirectIntent(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body()
    body: {
      amountCents: number;
      recipientType: 'GUIDE' | 'AGENCY';
      recipientId: string;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
    },
  ) {
    return this.paymentsService.createDirectPaymentIntent({
      user,
      amountCents: body.amountCents,
      recipientType: body.recipientType,
      recipientId: body.recipientId,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('wallet-pay')
  async walletPay(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body()
    body: {
      totalAmountCents: number;
      recipientType: 'GUIDE' | 'AGENCY';
      recipientId: string;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
    },
  ) {
    if (!body.idempotencyKey) {
      throw new BadRequestException('Missing idempotencyKey');
    }

    return this.paymentsService.createWalletPaymentTransfer({
      user,
      totalAmountCents: body.totalAmountCents,
      recipientType: body.recipientType,
      recipientId: body.recipientId,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('connect/onboarding-link')
  async connectOnboardingLink(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { ownerType: 'GUIDE' | 'AGENCY' },
  ) {
    return this.paymentsService.createConnectOnboardingLink({
      user,
      ownerType: body.ownerType,
    });
  }
}
