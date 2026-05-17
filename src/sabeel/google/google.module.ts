import { Module } from '@nestjs/common';
import { GooglePlacesService } from './google_places.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [GooglePlacesService],
  exports: [GooglePlacesService],
})
export class GoogleModule {}
