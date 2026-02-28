/// <reference types="vite/client" />
import type { Aircraft, AircraftCategory, AdsbApiResponse, AdsbApiAircraft } from '../types/aircraft.ts';

// Use Vite proxy in dev (/api/adsb → https://api.adsb.lol)
// In production, use a CORS proxy or direct URL if server supports it
const API_BASE = import.meta.env.DEV
  ? '/api/adsb/v2'
  : 'https://api.adsb.lol/v2';

const POLL_INTERVAL_MS = 8000;

function categorizeAircraft(ac: AdsbApiAircraft): AircraftCategory {
  const cat = ac.category?.toUpperCase() ?? '';
  const type = (ac.type ?? ac.t ?? '').toUpperCase();

  // Military aircraft
  if (cat === 'A7' || type.startsWith('F') || type.startsWith('B52') || type.startsWith('C17')) {
    return 'friend';
  }
  // Heavy commercial
  if (cat === 'A5' || cat === 'A6') {
    return 'civilian';
  }
  // Light aircraft
  if (cat === 'A1' || cat === 'A2') {
    return 'civilian';
  }
  // Helicopter
  if (cat === 'B1' || cat === 'B2') {
    return 'neutral';
  }
  // Default
  return 'unknown';
}

function normalizeAircraft(ac: AdsbApiAircraft, index: number): Aircraft | null {
  if (ac.lat === undefined || ac.lon === undefined) return null;
  if (Math.abs(ac.lat) > 90 || Math.abs(ac.lon) > 180) return null;

  const altBaro = ac.alt_baro;
  const altitudeFt = altBaro === 'ground' ? 0 : (altBaro ?? 0);

  return {
    icao24: ac.hex,
    callsign: (ac.flight ?? ac.hex).trim(),
    lat: ac.lat,
    lon: ac.lon,
    altitudeFt,
    trackDeg: ac.track ?? 0,
    groundSpeedKts: ac.gs ?? 0,
    verticalRateFpm: ac.baro_rate ?? 0,
    squawk: ac.squawk ?? '0000',
    category: categorizeAircraft(ac),
    typeCode: ac.type ?? ac.t ?? '',
    registration: ac.r ?? '',
    lastSeen: Date.now(),
    isOnGround: altBaro === 'ground',
  };
}

export class AdsbClient {
  private aircraft: Map<string, Aircraft> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isSimulating = false;
  private simAircraft: Aircraft[] = [];
  private simTime = 0;
  private onUpdate: ((aircraft: readonly Aircraft[]) => void) | null = null;
  private consecutiveFailures = 0;

  start(onUpdate: (aircraft: readonly Aircraft[]) => void): void {
    this.onUpdate = onUpdate;

    // Immediately show simulation data while waiting for first API response
    // This ensures the map is populated instantly
    this.activateSimulation();

    // Then try the real API
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isUsingSimulation(): boolean {
    return this.isSimulating;
  }

  getAircraftCount(): number {
    return this.isSimulating ? this.simAircraft.length : this.aircraft.size;
  }

  private async poll(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/pia`, {
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdsbApiResponse;
      this.consecutiveFailures = 0;

      if (this.isSimulating) {
        this.isSimulating = false;
        this.simAircraft = [];
      }

      // Update aircraft map
      const now = Date.now();
      const newAircraft = new Map<string, Aircraft>();

      for (const ac of data.ac) {
        const normalized = normalizeAircraft(ac, 0);
        if (normalized) {
          newAircraft.set(normalized.icao24, normalized);
        }
      }

      // Remove stale aircraft (not seen in last 30s)
      for (const [id, ac] of this.aircraft) {
        if (now - ac.lastSeen < 30000 && !newAircraft.has(id)) {
          newAircraft.set(id, ac);
        }
      }

      this.aircraft = newAircraft;
      this.onUpdate?.([...this.aircraft.values()]);
    } catch (err) {
      this.consecutiveFailures++;
      console.warn('ADS-B API failed, failure count:', this.consecutiveFailures, err);

      if (this.consecutiveFailures >= 1 && !this.isSimulating) {
        this.activateSimulation();
      } else if (this.isSimulating) {
        this.tickSimulation();
      }
    }
  }

  private activateSimulation(): void {
    console.info('Activating simulation fallback with 5000 aircraft');
    this.isSimulating = true;
    this.simAircraft = generateSimulatedAircraft(5000);
    this.onUpdate?.(this.simAircraft);
  }

  private tickSimulation(): void {
    this.simTime += POLL_INTERVAL_MS / 1000;
    this.simAircraft = this.simAircraft.map((ac) => {
      const speedDeg = (ac.groundSpeedKts / 3600) * (1 / 111.32);
      const trackRad = ac.trackDeg * (Math.PI / 180);
      const newLat = ac.lat + Math.cos(trackRad) * speedDeg * POLL_INTERVAL_MS / 1000;
      const newLon = ac.lon + Math.sin(trackRad) * speedDeg * POLL_INTERVAL_MS / 1000;

      return {
        ...ac,
        lat: Math.max(-85, Math.min(85, newLat)),
        lon: ((newLon + 180) % 360) - 180,
        lastSeen: Date.now(),
      };
    });
    this.onUpdate?.(this.simAircraft);
  }
}

// ─── Simulation Generator ────────────────────────────────────────────────────

const CATEGORIES: AircraftCategory[] = ['friend', 'hostile', 'neutral', 'unknown', 'civilian'];
const CATEGORY_WEIGHTS = [0.05, 0.02, 0.08, 0.15, 0.70];

// Major air corridors (lat1, lon1, lat2, lon2)
const CORRIDORS: [number, number, number, number][] = [
  [51.5, -0.1, 40.7, -74.0],   // London - New York
  [35.7, 139.7, 37.6, -122.4], // Tokyo - San Francisco
  [48.9, 2.3, 25.2, 55.3],     // Paris - Dubai
  [1.4, 103.8, 35.7, 139.7],   // Singapore - Tokyo
  [-33.9, 151.2, 1.4, 103.8],  // Sydney - Singapore
  [51.5, -0.1, 48.9, 2.3],     // London - Paris
  [40.7, -74.0, 34.0, -118.2], // New York - LA
  [19.4, -99.1, 40.7, -74.0],  // Mexico City - New York
  [55.8, 37.6, 48.9, 2.3],     // Moscow - Paris
  [-23.5, -46.6, 40.7, -74.0], // São Paulo - New York
];

function weightedRandom(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function generateSimulatedAircraft(count: number): Aircraft[] {
  const aircraft: Aircraft[] = [];

  for (let i = 0; i < count; i++) {
    // Pick a corridor or random position
    const useCorr = Math.random() < 0.7;
    let lat: number, lon: number, trackDeg: number;

    if (useCorr && CORRIDORS.length > 0) {
      const corrIdx = Math.floor(Math.random() * CORRIDORS.length);
      const corr = CORRIDORS[corrIdx];
      if (corr) {
        const [lat1, lon1, lat2, lon2] = corr;
        const t = Math.random();
        lat = lat1 + (lat2 - lat1) * t + (Math.random() - 0.5) * 2;
        lon = lon1 + (lon2 - lon1) * t + (Math.random() - 0.5) * 2;
        trackDeg = Math.atan2(lon2 - lon1, lat2 - lat1) * (180 / Math.PI);
      } else {
        lat = (Math.random() - 0.5) * 160;
        lon = (Math.random() - 0.5) * 360;
        trackDeg = Math.random() * 360;
      }
    } else {
      lat = (Math.random() - 0.5) * 160;
      lon = (Math.random() - 0.5) * 360;
      trackDeg = Math.random() * 360;
    }

    const catIdx = weightedRandom(CATEGORY_WEIGHTS);
    const category = CATEGORIES[catIdx] ?? 'unknown';
    const altitudeFt = 25000 + Math.random() * 15000;
    const groundSpeedKts = 400 + Math.random() * 200;

    const hex = i.toString(16).padStart(6, '0');

    aircraft.push({
      icao24: hex,
      callsign: `SIM${i.toString().padStart(4, '0')}`,
      lat,
      lon,
      altitudeFt,
      trackDeg: ((trackDeg % 360) + 360) % 360,
      groundSpeedKts,
      verticalRateFpm: (Math.random() - 0.5) * 200,
      squawk: Math.floor(Math.random() * 7777).toString().padStart(4, '0'),
      category,
      typeCode: 'B738',
      registration: `N${Math.floor(Math.random() * 99999)}`,
      lastSeen: Date.now(),
      isOnGround: false,
    });
  }

  return aircraft;
}
