import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GooglePlacesService } from '../google/google_places.service';
const Amadeus = require('amadeus');

@Injectable()
export class AmadeusService {
  private amadeus: any;

  constructor(
    private configService: ConfigService,
    private googlePlacesService: GooglePlacesService,
  ) {
    this.amadeus = new Amadeus({
      clientId: this.configService.get<string>('AMADEUS_API_KEY'),
      clientSecret: this.configService.get<string>('AMADEUS_API_SECRET'),
    });
  }

  /**
   * Search for flights to Saudi Arabia (JED, MED, RUH) from any origin
   * @param origin IATA code (e.g. PAR, LON, CAS)
   * @param date Departure date (YYYY-MM-DD)
   */
  async searchFlightsToSaudi(origin: string, date: string): Promise<any> {
    try {
      const destinations = ['JED', 'MED', 'RUH'];
      const data: any[] = [];
      let dictionaries: any = { carriers: {}, locations: {}, currencies: {} };

      for (const dest of destinations) {
        const response = await this.amadeus.shopping.flightOffersSearch.get({
          originLocationCode: origin,
          destinationLocationCode: dest,
          departureDate: date,
          adults: '1',
          currencyCode: origin === 'TUN' ? 'TND' : (origin === 'CDG' ? 'EUR' : 'USD'),
          max: 10,
        });
        if (response.data) {
            // Log for debugging (remove in prod if needed)
            console.log(`[AMADEUS] Flights found: ${response.data.length} from ${origin} to ${dest} (${response.data[0]?.price.currency})`);
            
            data.push(...response.data);
            dictionaries.carriers = { ...dictionaries.carriers, ...response.result.dictionaries.carriers };
            dictionaries.locations = { ...dictionaries.locations, ...response.result.dictionaries.locations };
        }
      }

      return { data, dictionaries };
    } catch (error) {
      console.error('[AMADEUS] Flight search error:', error.code, error.description || error.message);
      throw new InternalServerErrorException('Failed to fetch flight offers');
    }
  }

  /**
   * Search for hotels in any city
   * @param cityCode IATA city code (e.g. JED for Makkah region, MED for Madinah)
   */
  async searchHotels(cityCode: string): Promise<any> {
    try {
      const hotelsResponse = await this.amadeus.referenceData.locations.hotels.byCity.get({
        cityCode: cityCode,
      });

      const hotels = hotelsResponse.data || [];
        const enrichedHotels = await Promise.all(hotels.slice(0, 15).map(async (hotel: any) => {
            try {
                // Better city mapping for Google search
                const actualCity = cityCode === 'JED' ? (hotel.name.toLowerCase().includes('makkah') || hotel.name.toLowerCase().includes('mecca') ? 'Makkah' : 'Jeddah') : 
                                 (cityCode === 'MED' ? 'Madinah' : cityCode);
                
                const googleData = await this.googlePlacesService.enrichHotelPrecise(hotel);
                if (googleData) {
                    hotel.google_photos = googleData.photos;
                    hotel.google_rating = googleData.rating;
                    hotel.google_reviews_count = googleData.user_ratings_total;
                    hotel.confidence_score = googleData.confidenceScore;
                }
            } catch (e) {}
            return hotel;
        }));

      return enrichedHotels;
    } catch (error) {
      console.error('[AMADEUS] Hotel search error:', error.code, error.description || error.message);
      throw new InternalServerErrorException('Failed to fetch hotels');
    }
  }

  /**
   * Search for hotels near specific coordinates (Al Jumum, Bahrah, etc.)
   * @param latitude 
   * @param longitude 
   * @param radius 
   */
  async searchHotelsByGeocode(latitude: number, longitude: number, radius = 20): Promise<any> {
    try {
        const response = await this.amadeus.referenceData.locations.hotels.byGeocode.get({
            latitude,
            longitude,
            radius, // radius in KM
            radiusUnit: 'KM'
        });
        
        // Enrich the top 10 hotels with Google Photos directly
        const hotels = response.data || [];
        const enrichedHotels = await Promise.all(hotels.slice(0, 15).map(async (hotel: any) => {
            try {
                const query = `${hotel.name} hotel ${hotel.address?.cityName || ''}`.trim();
                const googleData = await this.googlePlacesService.enrichHotelPrecise(hotel);
                if (googleData) {
                    hotel.google_photos = googleData.photos;
                    hotel.google_rating = googleData.rating;
                    hotel.google_reviews_count = googleData.user_ratings_total;
                    hotel.confidence_score = googleData.confidenceScore;
                }
            } catch (e) {
                // Ignore enrichment errors
            }
            return hotel;
        }));

        return enrichedHotels;
    } catch (error) {
        console.error('[AMADEUS] Geocode Hotel search error:', error.code, error.description || error.message);
        return [];
    }
  }

  /**
   * Get Points of Interest for religious/Islamic visits
   * @param latitude 
   * @param longitude 
   */
  async getPointsOfInterest(latitude: number, longitude: number): Promise<any> {
    try {
        const response = await this.amadeus.referenceData.locations.pointsOfInterest.get({
            latitude,
            longitude,
            categories: 'SIGHTS,MUSEUMS', // Focus on landmarks
            radius: 20
        });
        return response.data;
    } catch (error) {
        // Silently handle decommissioned POI API
        return [];
    }
  }

  /**
   * Get hotel photos for given codes
   * @param hotelCodes Comma separated hotel codes
   */
  async getHotelPhotos(hotelCodes: string): Promise<any> {
    try {
        // Amadeus Media API for photos
        // Note: Some test accounts have limited access to this API.
        const response = await this.amadeus.referenceData.locations.hotels.byCity.get({
            hotelCodes: hotelCodes,
            view: 'FULL' // This often includes more metadata/media
        });
        
        // Actually, some versions of Amadeus use a different endpoint for media
        // If the above doesn't work, we return a nice curated set or try the shopping offers with view=FULL
        return response.data;
    } catch (error) {
        console.error('[AMADEUS] Hotel photos error:', error.code, error.description || error.message);
        // If photos fail, we'll handle it gracefully by not throwing to keep the list functional
        return [];
    }
  }

  /**
   * Get specific hotel offers enriched with Google photos/rating
   * @param hotelIds Comma separated hotel IDs
   */
  async getHotelOffers(hotelIds: string): Promise<any> {
    try {
        const response = await this.amadeus.shopping.hotelOffersSearch.get({
            hotelIds: hotelIds,
            adults: '1',
            view: 'FULL'
        });

        // Enrich the data with Google photos and rating
        const offers = response.data || [];
        const enrichedOffers = await Promise.all(offers.map(async (offer: any) => {
            try {
                const hotelName = offer.hotel?.name;
                const lat = offer.hotel?.latitude;
                const lng = offer.hotel?.longitude;

                if (hotelName) {
                    const googleData = await this.googlePlacesService.enrichHotelPrecise({
                        hotelId: offer.hotel?.hotelId,
                        name: hotelName,
                        geoCode: (lat && lng) ? { latitude: parseFloat(lat), longitude: parseFloat(lng) } : undefined,
                        address: { cityName: offer.hotel?.cityCode === 'JED' ? 'Makkah' : undefined }
                    });
                    
                    if (googleData) {
                        // Merge google data into hotel object
                        offer.hotel = {
                            ...offer.hotel,
                            google_rating: googleData.rating,
                            google_photos: googleData.photos,
                            google_reviews_count: googleData.user_ratings_total
                        };
                    }
                }
            } catch (err) {
                console.warn('[AMADEUS] Google enrichment failed for a hotel');
            }
            return offer;
        }));

        return enrichedOffers;
    } catch (error) {
        console.error('[AMADEUS] Hotel offers error:', error.code, error.description || error.message);
        throw new InternalServerErrorException('Failed to fetch hotel offers');
    }
  }
}
