import { Controller, Get, Query, InternalServerErrorException } from '@nestjs/common';
import { AmadeusService } from './amadeus.service';
import { ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Amadeus Travel')
@Controller('sabeel/amadeus')
export class AmadeusController {
  constructor(private amadeusService: AmadeusService) {}

  @Get('flights/to-saudi')
  @ApiQuery({ name: 'origin', required: true, description: 'Origin IATA code (e.g. PAR, LON, CAS)' })
  @ApiQuery({ name: 'date', required: true, description: 'Departure date (YYYY-MM-DD)' })
  async searchFlightsToSaudi(
    @Query('origin') origin: string,
    @Query('date') date = '2024-10-01',
  ) {
    if (!origin) origin = 'PAR'; // Default to Paris for testing
    return this.amadeusService.searchFlightsToSaudi(origin, date);
  }

  @Get('hotels/city')
  @ApiQuery({ name: 'city', required: true, description: 'City code (e.g. JED, MED, RUH)' })
  async searchHotelsInCity(
    @Query('city') city = 'JED',
  ) {
    return this.amadeusService.searchHotels(city);
  }

  @Get('hotels/geocode')
  @ApiQuery({ name: 'lat', required: true })
  @ApiQuery({ name: 'lng', required: true })
  @ApiQuery({ name: 'radius', required: false })
  async searchHotelsByGeocode(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 20,
  ) {
    return this.amadeusService.searchHotelsByGeocode(lat, lng, radius);
  }

  @Get('pois')
  @ApiQuery({ name: 'lat', required: true })
  @ApiQuery({ name: 'lng', required: true })
  async getPointsOfInterest(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
  ) {
    return this.amadeusService.getPointsOfInterest(lat, lng);
  }

  /**
   * For specific hotel deals
   * @param hotelIds Comma separated hotel IDs
   */
  @Get('hotels/offers')
  @ApiQuery({ name: 'hotelIds', required: true })
  async getHotelOffers(
      @Query('hotelIds') hotelIds: string
  ) {
      if (!hotelIds) throw new InternalServerErrorException('Hotel IDs required');
      return this.amadeusService.getHotelOffers(hotelIds);
  }
}
