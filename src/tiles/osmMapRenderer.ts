// OSM tile map renderer using Canvas 2D
// Renders individual OSM tiles as a proper tiled basemap

import { TileCache, type TileKey } from './tileCache.ts';
import { clamp } from '../utils/math.ts';

const TILE_SIZE = 256;

export class OsmMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileCache: TileCache;
  private lastCenterLon = NaN;
  private lastCenterLat = NaN;
  private lastZoom = -1;
  private lastWidth = 0;
  private lastHeight = 0;
  private pendingLoads = new Set<string>();

  constructor(tileCache: TileCache) {
    this.tileCache = tileCache;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 1;
      image-rendering: pixelated;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for OSM map renderer');
    this.ctx = ctx;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.canvas);
  }

  show(): void {
    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.canvas.style.display = 'none';
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.lastWidth = width;
    this.lastHeight = height;
    // Force redraw
    this.lastCenterLon = NaN;
  }

  render(centerLon: number, centerLat: number, zoom: number): void {
    const w = this.lastWidth;
    const h = this.lastHeight;
    if (w === 0 || h === 0) return;

    const z = Math.max(0, Math.min(19, Math.floor(zoom)));
    const fractionalZoom = zoom - Math.floor(zoom);
    const tileScale = Math.pow(2, fractionalZoom); // sub-tile zoom scaling

    const n = Math.pow(2, z);

    // Convert center lat/lon to tile coordinates (fractional)
    const centerTileX = ((centerLon + 180) / 360) * n;
    const latRad = centerLat * (Math.PI / 180);
    const centerTileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    // Effective tile size in pixels (accounting for fractional zoom)
    const effectiveTileSize = TILE_SIZE * tileScale;

    // How many tiles fit on screen
    const tilesX = Math.ceil(w / effectiveTileSize) + 2;
    const tilesY = Math.ceil(h / effectiveTileSize) + 2;

    // Pixel offset of center tile
    const centerPixelX = w / 2;
    const centerPixelY = h / 2;

    // Clear with dark background
    this.ctx.fillStyle = '#05080c';
    this.ctx.fillRect(0, 0, w, h);

    // Draw tiles
    const startTileX = Math.floor(centerTileX - tilesX / 2);
    const startTileY = Math.floor(centerTileY - tilesY / 2);

    for (let dy = 0; dy <= tilesY; dy++) {
      for (let dx = 0; dx <= tilesX; dx++) {
        const tileX = startTileX + dx;
        const tileY = startTileY + dy;

        // Wrap X (longitude wraps)
        const wrappedX = ((tileX % n) + n) % n;
        // Clamp Y (latitude doesn't wrap)
        const clampedY = clamp(tileY, 0, n - 1);

        // Pixel position of this tile's top-left corner
        const pixX = centerPixelX + (tileX - centerTileX) * effectiveTileSize;
        const pixY = centerPixelY + (tileY - centerTileY) * effectiveTileSize;

        const key: TileKey = { z, x: wrappedX, y: clampedY };
        const keyStr = `${z}/${wrappedX}/${clampedY}`;

        const bitmap = this.tileCache.getTile(key);

        if (bitmap) {
          // Draw tile with tactical tint
          this.ctx.save();
          this.ctx.globalAlpha = 0.85;
          this.ctx.drawImage(bitmap, pixX, pixY, effectiveTileSize, effectiveTileSize);
          this.ctx.restore();

          // Apply tactical dark overlay
          this.ctx.fillStyle = 'rgba(0, 10, 20, 0.25)';
          this.ctx.fillRect(pixX, pixY, effectiveTileSize, effectiveTileSize);
        } else {
          // Placeholder tile
          this.ctx.fillStyle = '#0a1520';
          this.ctx.fillRect(pixX, pixY, effectiveTileSize, effectiveTileSize);
          this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
          this.ctx.strokeRect(pixX + 0.5, pixY + 0.5, effectiveTileSize - 1, effectiveTileSize - 1);

          // Load tile asynchronously
          if (!this.pendingLoads.has(keyStr)) {
            this.pendingLoads.add(keyStr);
            this.tileCache.loadTile(key).then((bmp) => {
              this.pendingLoads.delete(keyStr);
              if (bmp) {
                // Trigger redraw on next frame
                this.lastCenterLon = NaN;
              }
            }).catch(() => {
              this.pendingLoads.delete(keyStr);
            });
          }
        }
      }
    }

    // Grid lines (subtle)
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    this.ctx.lineWidth = 0.5;
    for (let dy = 0; dy <= tilesY; dy++) {
      const tileY = startTileY + dy;
      const pixY = centerPixelY + (tileY - centerTileY) * effectiveTileSize;
      this.ctx.beginPath();
      this.ctx.moveTo(0, pixY);
      this.ctx.lineTo(w, pixY);
      this.ctx.stroke();
    }
    for (let dx = 0; dx <= tilesX; dx++) {
      const tileX = startTileX + dx;
      const pixX = centerPixelX + (tileX - centerTileX) * effectiveTileSize;
      this.ctx.beginPath();
      this.ctx.moveTo(pixX, 0);
      this.ctx.lineTo(pixX, h);
      this.ctx.stroke();
    }
  }

  destroy(): void {
    this.canvas.remove();
    this.pendingLoads.clear();
  }
}
