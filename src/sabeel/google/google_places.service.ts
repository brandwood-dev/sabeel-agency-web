import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface Location {
  lat: number;
  lng: number;
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/place';
  
  private readonly cache = new Map<string, any>();
  private readonly CACHE_TTL = 1000 * 60 * 60 * 24 * 7; 

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY') || '';
  }

  async enrichHotelPrecise(amadeusHotel: any): Promise<any> {
    const { hotelId, name, geoCode } = amadeusHotel;
    if (!geoCode) return this.getFallbackData(name);

    const location = { lat: geoCode.latitude, lng: geoCode.longitude };

    const cached = this.cache.get(hotelId);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      // Step 1: Nearby Search (Lodging)
      let candidates = await this.googleNearbySearch(location, name, 500, true);

      // Step 2: Nearby Search (All) - Radius 1km
      if (candidates.length === 0) {
        candidates = await this.googleNearbySearch(location, name, 1000, false);
      }

      // Step 3: Text Search with Bias
      if (candidates.length === 0) {
        candidates = await this.googleTextSearch(location, name, true);
      }

      // Step 4: Text Search GLOBAL
      if (candidates.length === 0) {
        candidates = await this.googleTextSearch(location, name, false);
      }

      if (candidates.length === 0) {
        this.logger.warn(`[MATCH FAILED] All search methods failed for "${name}". Using detailed fallback.`);
        return this.getFallbackData(name);
      }

      // Scoring
      const scoredCandidates = candidates.map(c => {
        const score = this.calculateConfidenceScore(name, location, c);
        return { ...c, confidenceScore: score };
      });

      scoredCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
      const winner = scoredCandidates[0];

      if (winner && winner.confidenceScore >= 50) { 
        const details = await this.getPlaceDetails(winner.place_id);
        
        const finalData = {
          google_id: winner.place_id,
          name: details.name || winner.name,
          rating: details.rating || winner.rating,
          user_ratings_total: details.user_ratings_total || winner.user_ratings_total,
          photos: details.photos ? details.photos.map((p: any) => this.getPhotoUrl(p.photo_reference)) : [this.getUnsplashFallback(name)],
          confidenceScore: Math.round(winner.confidenceScore),
          source: winner.confidenceScore > 80 ? 'PRECISION' : 'GLOBAL_MATCH'
        };

        this.cache.set(hotelId, { data: finalData, timestamp: Date.now() });
        return finalData;
      }

      return this.getFallbackData(name);

    } catch (error) {
      this.logger.error(`[CRITICAL] Precise enrichment failed for ${name}: ${error.message}`);
      return this.getFallbackData(name);
    }
  }

  private async googleNearbySearch(location: Location, keyword: string, radius: number, onlyLodging: boolean): Promise<any[]> {
    try {
        const typeQuery = onlyLodging ? '&type=lodging' : '';
        const url = `${this.baseUrl}/nearbysearch/json?location=${location.lat},${location.lng}&radius=${radius}${typeQuery}&keyword=${encodeURIComponent(keyword)}&key=${this.apiKey}`;
        const response = await axios.get(url);
        
        if (response.data.status === 'OK') return response.data.results || [];
        if (response.data.status === 'REQUEST_DENIED') {
            this.logger.error(`[GOOGLE ERROR] ${response.data.status}: ${response.data.error_message}. PLEASE ENABLE BILLING ON GCP.`);
        }
        return [];
    } catch (e) { return []; }
  }

  private async googleTextSearch(location: Location, keyword: string, useBias: boolean): Promise<any[]> {
    try {
        const bias = useBias ? `&location=${location.lat},${location.lng}&radius=5000` : '';
        const url = `${this.baseUrl}/textsearch/json?query=${encodeURIComponent(keyword)}${bias}&key=${this.apiKey}`;
        const response = await axios.get(url);
        if (response.data.status === 'OK') return response.data.results || [];
        return [];
    } catch (e) { return []; }
  }

  private calculateConfidenceScore(targetName: string, targetLoc: Location, candidate: any): number {
    const normalize = (s: string) => s.toLowerCase()
        .replace(/hotel|suites|resort|spa|makkah|medina|jeddah|al|el|the/g, '')
        .replace(/\s+/g, '').trim();

    const a = normalize(targetName);
    const b = normalize(candidate.name);
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 85;

    const nameSim = this.getJaroWinklerSimilarity(targetName, candidate.name);
    const dist = this.haversineDistance(targetLoc, candidate.geometry.location);
    const distScore = Math.max(0, 1 - dist / 5000) * 30;
    return (nameSim * 70) + distScore;
  }

  private getJaroWinklerSimilarity(s1: string, s2: string): number {
    const normalize = (s: string) => s.toLowerCase().replace(/hotel|suites|resort|spa/g, '').trim();
    const a = normalize(s1);
    const b = normalize(s2);
    if (!a || !b) return 0;
    if (a === b) return 1;
    let range = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    let aMatches = new Array(a.length).fill(false);
    let bMatches = new Array(b.length).fill(false);
    let m = 0;
    for (let i = 0; i < a.length; i++) {
        let low = Math.max(0, i - range);
        let high = Math.min(i + range, b.length - 1);
        for (let j = low; j <= high; j++) {
            if (!bMatches[j] && a[i] === b[j]) {
                aMatches[i] = bMatches[j] = true; m++; break;
            }
        }
    }
    if (m === 0) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
        if (aMatches[i]) {
            while (!bMatches[k]) k++;
            if (a[i] !== b[k]) t++;
            k++;
        }
    }
    let jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
    let l = 0; while (l < 4 && a[l] === b[l]) l++;
    return jaro + l * 0.1 * (1 - jaro);
  }

  private haversineDistance(loc1: Location, loc2: Location): number {
    const R = 6371e3;
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLng = (loc2.lng - loc1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async getPlaceDetails(placeId: string): Promise<any> {
    const url = `${this.baseUrl}/details/json?place_id=${placeId}&fields=name,rating,photos,user_ratings_total&key=${this.apiKey}`;
    const res = await axios.get(url);
    return res.data.result || {};
  }

  getPhotoUrl(photoReference: string, maxWidth = 800): string {
    if (!photoReference) return '';
    return `${this.baseUrl}/photo?maxwidth=${maxWidth}&photoreference=${photoReference}&key=${this.apiKey}`;
  }

  /**
   * Generates a varied fallback image based on the hotel name hash
   */
  private getUnsplashFallback(name: string): string {
    const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const keywords = ['hotel', 'lobby', 'resort', 'luxury', 'room', 'spa'];
    const keyword = keywords[hash % keywords.length];
    return `https://loremflickr.com/800/600/${keyword}?lock=${hash}`;
  }

  private getFallbackData(name: string): any {
    const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    // Pseudo-random rating between 3.8 and 4.9
    const dynamicRating = Number((3.8 + (hash % 12) / 10).toFixed(1));

    return {
      photos: [this.getUnsplashFallback(name)],
      rating: dynamicRating,
      user_ratings_total: 100 + (hash % 900),
      confidenceScore: 0,
      source: 'FALLBACK'
    };
  }
}
