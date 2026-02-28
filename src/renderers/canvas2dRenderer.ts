// Canvas 2D renderer for aircraft symbols and labels in 2D map mode
// Renders directly on top of the OSM tile map

import type { Aircraft, AircraftCategory } from '../types/aircraft.ts';
import { clamp } from '../utils/math.ts';

const SYMBOL_SIZE = 8; // half-size of symbol in pixels
const LABEL_OFFSET = 12;

const CATEGORY_COLORS: Record<AircraftCategory, string> = {
  friend: '#00e5ff',
  hostile: '#ff3333',
  neutral: '#33ff44',
  unknown: '#ffee11',
  civilian: '#ff44ff',
};

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animTime = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 6;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for aircraft renderer');
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
  }

  render(
    aircraft: readonly Aircraft[],
    centerLon: number,
    centerLat: number,
    zoom: number,
    selectedIcao: string | null,
    time: number
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.animTime = time;

    this.ctx.clearRect(0, 0, w, h);

    const scale = 360 / Math.pow(2, zoom);
    const aspect = w / h;
    const halfW = scale * aspect * 0.5;
    const halfH = scale * 0.5;
    const lonMin = centerLon - halfW;
    const lonMax = centerLon + halfW;
    const latMin = centerLat - halfH;
    const latMax = centerLat + halfH;

    // Show labels when zoomed in enough
    const showLabels = zoom >= 4;

    // Draw all aircraft
    for (const ac of aircraft) {
      if (ac.lon < lonMin || ac.lon > lonMax || ac.lat < latMin || ac.lat > latMax) continue;

      const sx = ((ac.lon - lonMin) / (lonMax - lonMin)) * w;
      const sy = ((latMax - ac.lat) / (latMax - latMin)) * h;

      const isSelected = ac.icao24 === selectedIcao;
      this.drawAircraftSymbol(sx, sy, ac, isSelected);

      if (showLabels || isSelected) {
        this.drawLabel(sx, sy, ac, isSelected);
      }
    }
  }

  private drawAircraftSymbol(
    x: number,
    y: number,
    ac: Aircraft,
    isSelected: boolean
  ): void {
    const ctx = this.ctx;
    const color = CATEGORY_COLORS[ac.category] ?? '#aaaaaa';
    const s = SYMBOL_SIZE;
    const trackRad = ac.trackDeg * (Math.PI / 180);

    ctx.save();
    ctx.translate(x, y);

    // Selection ring
    if (isSelected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 4);
      const ringR = s * 2 + pulse * 4;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(trackRad);

    // Draw shape based on category
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.5;

    switch (ac.category) {
      case 'friend':
        drawRoundedRect(ctx, -s * 0.7, -s * 0.5, s * 1.4, s, s * 0.3);
        break;
      case 'hostile':
        drawDiamond(ctx, s * 0.8);
        break;
      case 'neutral':
        drawSquare(ctx, s * 0.7);
        break;
      default:
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }

    // Heading arrow
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.3);
    ctx.lineTo(-s * 0.25, -s * 0.7);
    ctx.lineTo(s * 0.25, -s * 0.7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawLabel(
    x: number,
    y: number,
    ac: Aircraft,
    isSelected: boolean
  ): void {
    const ctx = this.ctx;
    const label = ac.callsign || ac.icao24.toUpperCase();
    const color = isSelected ? '#00e5ff' : (CATEGORY_COLORS[ac.category] ?? '#aaaaaa');

    ctx.font = isSelected ? 'bold 11px "Share Tech Mono", monospace' : '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';

    const lx = x + LABEL_OFFSET;
    const ly = y + 3;

    const metrics = ctx.measureText(label);
    const tw = metrics.width;
    const th = 12;

    // Background
    ctx.fillStyle = 'rgba(5, 8, 12, 0.8)';
    ctx.fillRect(lx - 2, ly - th / 2 - 1, tw + 4, th + 2);

    // Text
    if (isSelected) {
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 4;
    }
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
    ctx.shadowBlur = 0;
  }

  destroy(): void {
    this.canvas.remove();
  }
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDiamond(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSquare(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.rect(-s, -s, s * 2, s * 2);
  ctx.fill();
  ctx.stroke();
}
