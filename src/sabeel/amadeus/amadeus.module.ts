import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AmadeusService } from './amadeus.service';
import { AmadeusController } from './amadeus.controller';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [ConfigModule, GoogleModule],
  controllers: [AmadeusController],
  providers: [AmadeusService],
  exports: [AmadeusService],
})
export class SabeelAmadeusModule {}
