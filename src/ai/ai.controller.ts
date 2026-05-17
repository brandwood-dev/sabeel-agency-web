import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  async chat(@Body() body: { prompt: string; lang?: string }, @Req() req: any) {
    const { prompt, lang } = body;
    const agencyId = req.user.sub;
    const response = await this.aiService.generateContent(prompt, agencyId, lang);
    return { response };
  }

  @Post('chat-public')
  async chatPublic(@Body() body: { prompt: string; lang?: string }) {
    const { prompt, lang } = body;
    const response = await this.aiService.generateContent(prompt, undefined, lang);
    return { response };
  }
}
