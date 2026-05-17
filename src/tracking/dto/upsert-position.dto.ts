export class UpsertPositionDto {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  deviceTimestamp?: string;
}
