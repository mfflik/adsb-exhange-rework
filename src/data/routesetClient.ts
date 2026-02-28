// adsb.lol routeset API client
// POST /api/0/routeset - returns route info for aircraft by callsign

export interface RouteAirport {
  readonly iata: string;
  readonly icao: string;
  readonly name: string;
  readonly location: string;
  readonly countryiso2: string;
  readonly lat: number;
  readonly lon: number;
  readonly alt_feet: number;
}

export interface RouteInfo {
  readonly callsign: string;
  readonly airline_code: string;
  readonly number: string;
  readonly airport_codes: string;
  readonly _airport_codes_iata: string;
  readonly _airports: readonly RouteAirport[];
  readonly plausible: number;
}

interface RoutesetRequest {
  readonly callsign: string;
  readonly lat: number;
  readonly lng: number;
}

// Cache route info to avoid repeated API calls
const routeCache = new Map<string, RouteInfo | null>();
const pendingRequests = new Map<string, Promise<RouteInfo | null>>();

const ROUTESET_URL = import.meta.env.DEV
  ? '/api/adsb/api/0/routeset'
  : 'https://api.adsb.lol/api/0/routeset';

export async function fetchRouteInfo(
  callsign: string,
  lat: number,
  lon: number
): Promise<RouteInfo | null> {
  if (!callsign || callsign.trim() === '') return null;

  const key = callsign.trim().toUpperCase();

  // Return cached result
  if (routeCache.has(key)) {
    return routeCache.get(key) ?? null;
  }

  // Return in-flight request
  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const promise = doFetch(key, lat, lon);
  pendingRequests.set(key, promise);

  try {
    const result = await promise;
    routeCache.set(key, result);
    return result;
  } finally {
    pendingRequests.delete(key);
  }
}

async function doFetch(callsign: string, lat: number, lon: number): Promise<RouteInfo | null> {
  try {
    const body: RoutesetRequest[] = [{ callsign, lat, lng: lon }];

    const response = await fetch(ROUTESET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as RouteInfo[];
    return data[0] ?? null;
  } catch {
    return null;
  }
}

export function clearRouteCache(): void {
  routeCache.clear();
}
