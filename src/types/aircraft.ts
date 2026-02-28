// ADS-B API raw response types
export interface AdsbApiAircraft {
  readonly hex: string;
  readonly flight?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly alt_baro?: number | 'ground';
  readonly alt_geom?: number;
  readonly track?: number;
  readonly gs?: number;
  readonly baro_rate?: number;
  readonly squawk?: string;
  readonly category?: string;
  readonly type?: string;
  readonly r?: string;
  readonly t?: string;
  readonly seen?: number;
  readonly seen_pos?: number;
  readonly messages?: number;
}

export interface AdsbApiResponse {
  readonly ac: readonly AdsbApiAircraft[];
  readonly total: number;
  readonly now: number;
  readonly ctime: number;
  readonly ptime: number;
}

// Internal normalized aircraft model
export type AircraftCategory =
  | 'friend'
  | 'hostile'
  | 'neutral'
  | 'unknown'
  | 'civilian';

export interface Aircraft {
  readonly icao24: string;
  readonly callsign: string;
  readonly lat: number;
  readonly lon: number;
  readonly altitudeFt: number;
  readonly trackDeg: number;
  readonly groundSpeedKts: number;
  readonly verticalRateFpm: number;
  readonly squawk: string;
  readonly category: AircraftCategory;
  readonly typeCode: string;
  readonly registration: string;
  readonly lastSeen: number;
  readonly isOnGround: boolean;
}

// GPU instance data layout (per aircraft, packed as f32)
// layout: [x, y, z, trackRad, colorR, colorG, colorB, categoryId, selected, pad, pad, pad]
export const AIRCRAFT_INSTANCE_FLOATS = 12;
export const AIRCRAFT_INSTANCE_BYTES = AIRCRAFT_INSTANCE_FLOATS * 4;

export interface AircraftFilter {
  minAltitudeFt: number;
  maxAltitudeFt: number;
  categories: Set<AircraftCategory>;
  searchCallsign: string;
}

export function defaultFilter(): AircraftFilter {
  return {
    minAltitudeFt: -1000,
    maxAltitudeFt: 60000,
    categories: new Set(['friend', 'hostile', 'neutral', 'unknown', 'civilian']),
    searchCallsign: '',
  };
}
