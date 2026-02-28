// Canvas 2D overlay for aircraft callsign labels
// Renders text to the right of each aircraft symbol
// Works for both 3D (perspective) and 2D (ortho) modes

import type { Aircraft } from '../types/aircraft.ts';
import type { Mat4 } from '../utils/math.ts';

const LABEL_OFFSET_X = 12; // pixels right of symbol center
const LABEL_OFFSET_Y = 4;  // pixels down from center
const MAX_LABELS_3D = 300; // limit labels in 3D for performance
const MAX_LABELS_2D = 500;
const MIN_ZOOM_FOR_LABELS_2D = 3.5;

export class LabelOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 8;
    `;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for label overlay');
    this.ctx = ctx;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.canvas);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  render(
    aircraft: readonly Aircraft[],
    viewProj: Mat4,
    canvasWidth: number,
    canvasHeight: number,
    selectedIcao: string | null,
    mode: '3d' | '2d',
    zoom: number,
    centerLon: number,
    centerLat: number
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const showAllLabels = mode === '2d'
      ? zoom >= MIN_ZOOM_FOR_LABELS_2D
      : false; // In 3D, only show selected + nearby

    const maxLabels = mode === '3d' ? MAX_LABELS_3D : MAX_LABELS_2D;

    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';

    let labelCount = 0;

    for (const ac of aircraft) {
      if (labelCount >= maxLabels) break;

      const isSelected = ac.icao24 === selectedIcao;

      // Always show selected aircraft label
      if (!showAllLabels && !isSelected) continue;

      const screen = mode === '3d'
        ? this.project3D(ac, viewProj, canvasWidth, canvasHeight)
        : this.project2D(ac, canvasWidth, canvasHeight, centerLon, centerLat, zoom);

      if (!screen) continue;

      const label = ac.callsign || ac.icao24.toUpperCase();
      this.drawLabel(ctx, label, screen.x, screen.y, isSelected, ac.category);
      labelCount++;
    }
  }

  private project3D(
    ac: Aircraft,
    viewProj: Mat4,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number } | null {
    const DEG2RAD = Math.PI / 180;
    const lat = ac.lat * DEG2RAD;
    const lon = ac.lon * DEG2RAD;
    const cosLat = Math.cos(lat);
    const r = 1.002;
    const wx = cosLat * Math.sin(lon) * r;
    const wy = Math.sin(lat) * r;
    const wz = cosLat * Math.cos(lon) * r;

    // Multiply by viewProj (column-major mat4)
    const m = viewProj;
    const cx = (m[0] ?? 0) * wx + (m[4] ?? 0) * wy + (m[8] ?? 0) * wz + (m[12] ?? 0);
    const cy = (m[1] ?? 0) * wx + (m[5] ?? 0) * wy + (m[9] ?? 0) * wz + (m[13] ?? 0);
    const cw = (m[3] ?? 0) * wx + (m[7] ?? 0) * wy + (m[11] ?? 0) * wz + (m[15] ?? 0);

    if (cw <= 0.01) return null; // behind camera

    const ndcX = cx / cw;
    const ndcY = cy / cw;

    // Clip check
    if (ndcX < -1.05 || ndcX > 1.05 || ndcY < -1.05 || ndcY > 1.05) return null;

    return {
      x: (ndcX * 0.5 + 0.5) * canvasWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * canvasHeight,
    };
  }

  private project2D(
    ac: Aircraft,
    canvasWidth: number,
    canvasHeight: number,
    centerLon: number,
    centerLat: number,
    zoom: number
  ): { x: number; y: number } | null {
    const scale = 360 / Math.pow(2, zoom);
    const aspect = canvasWidth / canvasHeight;
    const halfW = scale * aspect * 0.5;
    const halfH = scale * 0.5;

    const lonMin = centerLon - halfW;
    const lonMax = centerLon + halfW;
    const latMin = centerLat - halfH;
    const latMax = centerLat + halfH;

    if (ac.lon < lonMin || ac.lon > lonMax || ac.lat < latMin || ac.lat > latMax) return null;

    const x = ((ac.lon - lonMin) / (lonMax - lonMin)) * canvasWidth;
    const y = ((latMax - ac.lat) / (latMax - latMin)) * canvasHeight;

    return { x, y };
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    isSelected: boolean,
    category: string
  ): void {
    const lx = x + LABEL_OFFSET_X;
    const ly = y + LABEL_OFFSET_Y;

    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = 12;

    // Background
    ctx.fillStyle = 'rgba(5, 8, 12, 0.82)';
    ctx.fillRect(lx - 2, ly - th / 2 - 1, tw + 4, th + 2);

    // Text color
    if (isSelected) {
      ctx.fillStyle = '#00e5ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 5;
      ctx.font = 'bold 11px "Share Tech Mono", monospace';
    } else {
      ctx.fillStyle = getCategoryColor(category);
      ctx.shadowBlur = 0;
      ctx.font = '10px "Share Tech Mono", monospace';
    }

    ctx.fillText(text, lx, ly);
    ctx.shadowBlur = 0;
  }

  destroy(): void {
    this.canvas.remove();
  }
}

function getCategoryColor(category: string): string {
  switch (category) {
    case 'friend': return '#00e5ff';
    case 'hostile': return '#ff3333';
    case 'neutral': return '#33ff44';
    case 'unknown': return '#ffee11';
    case 'civilian': return '#ff44ff';
    default: return '#aaaaaa';
  }
}
