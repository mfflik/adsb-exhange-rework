// Assembles OSM tiles into a single GPU texture for rendering
import { TileCache, type TileKey } from './tileCache.ts';
import { latLonToTile, clamp } from '../utils/math.ts';

const TILE_SIZE = 256;
const ATLAS_TILES = 8; // 8x8 grid = 64 tiles
const ATLAS_SIZE = TILE_SIZE * ATLAS_TILES; // 2048x2048

export interface TileAtlas {
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  // UV transform: [offsetU, offsetV, scaleU, scaleV]
  readonly uvTransform: Float32Array;
}

export class TileCompositor {
  private readonly cache: TileCache;
  private texture: GPUTexture | null = null;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private lastCenterLon = NaN;
  private lastCenterLat = NaN;
  private lastZoom = -1;

  constructor(cache: TileCache) {
    this.cache = cache;
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for tile compositor');
    this.ctx = ctx;
  }

  async update(
    device: GPUDevice,
    centerLon: number,
    centerLat: number,
    zoom: number
  ): Promise<GPUTexture> {
    const z = Math.max(0, Math.min(19, Math.floor(zoom)));

    // Only rebuild if view changed significantly
    const needsRebuild =
      Math.abs(centerLon - this.lastCenterLon) > 0.01 ||
      Math.abs(centerLat - this.lastCenterLat) > 0.01 ||
      z !== this.lastZoom;

    if (!needsRebuild && this.texture) {
      return this.texture;
    }

    this.lastCenterLon = centerLon;
    this.lastCenterLat = centerLat;
    this.lastZoom = z;

    const [centerTileX, centerTileY] = latLonToTile(centerLat, centerLon, z);
    const half = Math.floor(ATLAS_TILES / 2);
    const maxTile = Math.pow(2, z) - 1;

    // Clear canvas
    this.ctx.fillStyle = '#05080c';
    this.ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    // Load and draw tiles
    const promises: Promise<void>[] = [];

    for (let dy = 0; dy < ATLAS_TILES; dy++) {
      for (let dx = 0; dx < ATLAS_TILES; dx++) {
        const tileX = clamp(centerTileX - half + dx, 0, maxTile);
        const tileY = clamp(centerTileY - half + dy, 0, maxTile);
        const key: TileKey = { z, x: tileX, y: tileY };
        const px = dx * TILE_SIZE;
        const py = dy * TILE_SIZE;

        const bitmap = this.cache.getTile(key);
        if (bitmap) {
          this.ctx.drawImage(bitmap, px, py, TILE_SIZE, TILE_SIZE);
        } else {
          // Draw placeholder
          this.ctx.fillStyle = '#0a1020';
          this.ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          this.ctx.strokeStyle = '#1a2030';
          this.ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

          // Async load
          promises.push(
            this.cache.loadTile(key).then((bmp) => {
              if (bmp) {
                this.ctx.drawImage(bmp, px, py, TILE_SIZE, TILE_SIZE);
              }
            })
          );
        }
      }
    }

    // Wait for immediate tiles, don't block on all
    await Promise.race([
      Promise.all(promises),
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);

    // Upload to GPU
    if (this.texture) {
      this.texture.destroy();
    }

    this.texture = device.createTexture({
      size: { width: ATLAS_SIZE, height: ATLAS_SIZE },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const imageBitmap = await createImageBitmap(this.canvas);
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: this.texture },
      { width: ATLAS_SIZE, height: ATLAS_SIZE }
    );
    imageBitmap.close();

    return this.texture;
  }

  getTexture(): GPUTexture | null {
    return this.texture;
  }

  destroy(): void {
    this.texture?.destroy();
    this.texture = null;
    this.cache.clear();
  }
}
