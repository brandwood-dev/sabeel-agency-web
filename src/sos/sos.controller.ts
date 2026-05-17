import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SosService } from './sos.service';

@Controller('sos')
@UseGuards(JwtAuthGuard)
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Get('me/contacts')
  async getMyContacts(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.sosService.getMySosContacts({ currentUser: user });
  }
}
