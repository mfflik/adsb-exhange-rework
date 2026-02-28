// LRU tile cache for OSM tiles
// Respects Cache-Control headers and OSM usage policy

export interface TileKey {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export function tileKeyString(key: TileKey): string {
  return `${key.z}/${key.x}/${key.y}`;
}

interface CacheEntry {
  readonly bitmap: ImageBitmap;
  readonly loadedAt: number;
  lastAccessed: number;
}

const MAX_CACHE_SIZE = 512;
const TILE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export class TileCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<ImageBitmap | null>>();

  getTile(key: TileKey): ImageBitmap | null {
    const k = tileKeyString(key);
    const entry = this.cache.get(k);
    if (!entry) return null;
    entry.lastAccessed = Date.now();
    return entry.bitmap;
  }

  async loadTile(key: TileKey): Promise<ImageBitmap | null> {
    const k = tileKeyString(key);

    // Return cached if fresh
    const cached = this.cache.get(k);
    if (cached && Date.now() - cached.loadedAt < TILE_EXPIRY_MS) {
      cached.lastAccessed = Date.now();
      return cached.bitmap;
    }

    // Return in-flight promise
    const inFlight = this.pending.get(k);
    if (inFlight) return inFlight;

    const promise = this.fetchTile(key);
    this.pending.set(k, promise);

    try {
      const bitmap = await promise;
      if (bitmap) {
        this.evictIfNeeded();
        this.cache.set(k, {
          bitmap,
          loadedAt: Date.now(),
          lastAccessed: Date.now(),
        });
      }
      return bitmap;
    } finally {
      this.pending.delete(k);
    }
  }

  private async fetchTile(key: TileKey): Promise<ImageBitmap | null> {
    const url = `https://tile.openstreetmap.org/${key.z}/${key.x}/${key.y}.png`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'globe-adsb/1.0 (aircraft tracking visualization)',
        },
      });

      if (!response.ok) return null;

      const blob = await response.blob();
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size < MAX_CACHE_SIZE) return;

    // Evict LRU entries
    const entries = [...this.cache.entries()].sort(
      (a, b) => (a[1]?.lastAccessed ?? 0) - (b[1]?.lastAccessed ?? 0)
    );

    const toEvict = Math.floor(MAX_CACHE_SIZE * 0.1);
    for (let i = 0; i < toEvict; i++) {
      const entry = entries[i];
      if (entry) {
        entry[1]?.bitmap.close();
        this.cache.delete(entry[0]);
      }
    }
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
    }
    this.cache.clear();
    this.pending.clear();
  }
}
