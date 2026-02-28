// WebGPU aircraft overlay renderer
// Works with MapTalks: projects lat/lon to screen pixels each frame

import type { Aircraft, AircraftCategory } from '../types/aircraft.ts';
import { DEG2RAD } from '../utils/math.ts';
import aircraft2dWgsl from '../shaders/aircraft2d.wgsl?raw';

// Per-instance: 12 floats
const INSTANCE_FLOATS = 12;
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
const MAX_AIRCRAFT = 15000;

const CATEGORY_COLORS: Record<AircraftCategory, [number, number, number]> = {
  friend: [0.0, 0.9, 1.0],
  hostile: [0.97, 0.32, 0.29],
  neutral: [0.24, 0.87, 0.31],
  unknown: [0.82, 0.60, 0.13],
  civilian: [0.74, 0.55, 1.0],
};

const CATEGORY_IDS: Record<AircraftCategory, number> = {
  friend: 0, hostile: 1, neutral: 2, unknown: 3, civilian: 4,
};

export interface ScreenProjector {
  latLonToPixel(lat: number, lon: number): { x: number; y: number } | null;
  getBounds(): { minLon: number; maxLon: number; minLat: number; maxLat: number };
}

export class AircraftOverlay {
  private device: GPUDevice | null = null;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private instanceCount = 0;
  private readonly instanceArrayBuffer: ArrayBuffer;
  private readonly instanceData: Float32Array<ArrayBuffer>;

  // Label canvas overlay
  private labelCanvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;

  constructor() {
    this.instanceArrayBuffer = new ArrayBuffer(MAX_AIRCRAFT * INSTANCE_BYTES);
    this.instanceData = new Float32Array(this.instanceArrayBuffer);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none; z-index: 3;
    `;

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none; z-index: 4;
    `;
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.labelCtx = ctx;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.canvas);
    container.appendChild(this.labelCanvas);
  }

  async initGpu(): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');

    this.device = await adapter.requestDevice({
      requiredLimits: { maxBufferSize: 64 * 1024 * 1024 },
    });

    this.device.lost.then((info: GPUDeviceLostInfo) => {
      console.error('WebGPU device lost:', info.message);
    });

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('Failed to get WebGPU context');
    this.context = ctx;

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    await this.buildPipeline();
  }

  private async buildPipeline(): Promise<void> {
    const device = this.device!;

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceBuffer = device.createBuffer({
      size: MAX_AIRCRAFT * INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: aircraft2dWgsl });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(width * dpr);
    const h = Math.floor(height * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.labelCanvas.width = w;
    this.labelCanvas.height = h;

    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });
    }
  }

  render(
    aircraft: readonly Aircraft[],
    projector: ScreenProjector,
    selectedIcao: string | null,
    time: number,
    zoom: number
  ): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer || !this.instanceBuffer) return;

    const device = this.device;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;

    if (w === 0 || h === 0) return;

    const bounds = projector.getBounds();
    const showLabels = zoom >= 8;

    // Build instance data
    let count = 0;
    const labelItems: Array<{ x: number; y: number; label: string; isSelected: boolean; category: AircraftCategory }> = [];

    for (const ac of aircraft) {
      if (count >= MAX_AIRCRAFT) break;

      // Quick bounds check
      if (ac.lon < bounds.minLon - 1 || ac.lon > bounds.maxLon + 1 ||
          ac.lat < bounds.minLat - 1 || ac.lat > bounds.maxLat + 1) continue;

      const screen = projector.latLonToPixel(ac.lat, ac.lon);
      if (!screen) continue;

      const sx = screen.x * dpr;
      const sy = screen.y * dpr;

      // Cull off-screen
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

      const isSelected = ac.icao24 === selectedIcao;
      const color = CATEGORY_COLORS[ac.category] ?? [1, 1, 0];
      const catId = CATEGORY_IDS[ac.category] ?? 3;
      const trackRad = ac.trackDeg * DEG2RAD;

      const base = count * INSTANCE_FLOATS;
      this.instanceData[base + 0] = sx;
      this.instanceData[base + 1] = sy;
      this.instanceData[base + 2] = trackRad;
      this.instanceData[base + 3] = catId;
      this.instanceData[base + 4] = color[0] ?? 1;
      this.instanceData[base + 5] = color[1] ?? 1;
      this.instanceData[base + 6] = color[2] ?? 0;
      this.instanceData[base + 7] = isSelected ? 1.0 : 0.0;
      this.instanceData[base + 8] = count;
      this.instanceData[base + 9] = 0;
      this.instanceData[base + 10] = 0;
      this.instanceData[base + 11] = 0;
      count++;

      if (showLabels || isSelected) {
        labelItems.push({
          x: screen.x * dpr,
          y: screen.y * dpr,
          label: ac.callsign || ac.icao24.toUpperCase(),
          isSelected,
          category: ac.category,
        });
      }
    }

    this.instanceCount = count;

    // Update GPU buffers
    const uniforms = new Float32Array([w, h, time, dpr]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    if (count > 0) {
      device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, count * INSTANCE_FLOATS);
    }

    // Render aircraft
    const encoder = device.createCommandEncoder();
    const colorView = this.context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    if (count > 0) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6, count, 0, 0);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    // Render labels on Canvas 2D
    this.renderLabels(labelItems, w, h);
  }

  private renderLabels(
    items: Array<{ x: number; y: number; label: string; isSelected: boolean; category: AircraftCategory }>,
    w: number,
    h: number
  ): void {
    const ctx = this.labelCtx;
    ctx.clearRect(0, 0, w, h);

    for (const item of items) {
      const lx = item.x + 12;
      const ly = item.y + 3;

      ctx.font = item.isSelected
        ? 'bold 11px "JetBrains Mono", monospace'
        : '10px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(item.label);
      const tw = metrics.width;
      const th = 12;

      // Background
      ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
      ctx.fillRect(lx - 2, ly - th / 2 - 1, tw + 4, th + 2);

      // Text
      if (item.isSelected) {
        ctx.fillStyle = '#58a6ff';
        ctx.shadowColor = '#58a6ff';
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = getCategoryColor(item.category);
        ctx.shadowBlur = 0;
      }

      ctx.fillText(item.label, lx, ly);
      ctx.shadowBlur = 0;
    }
  }

  /** Pick aircraft at screen pixel (returns aircraft index or -1) */
  pickAtPixel(
    aircraft: readonly Aircraft[],
    projector: ScreenProjector,
    screenX: number,
    screenY: number
  ): number {
    const dpr = window.devicePixelRatio || 1;
    const px = screenX * dpr;
    const py = screenY * dpr;
    const hitRadius = 14 * dpr;

    let bestDist = hitRadius;
    let bestIdx = -1;

    for (let i = 0; i < aircraft.length; i++) {
      const ac = aircraft[i];
      if (!ac) continue;

      const screen = projector.latLonToPixel(ac.lat, ac.lon);
      if (!screen) continue;

      const dx = screen.x * dpr - px;
      const dy = screen.y * dpr - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx;
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.canvas.remove();
    this.labelCanvas.remove();
  }
}

function getCategoryColor(category: AircraftCategory): string {
  switch (category) {
    case 'friend': return '#39d0d8';
    case 'hostile': return '#f85149';
    case 'neutral': return '#3fb950';
    case 'unknown': return '#d29922';
    case 'civilian': return '#bc8cff';
    default: return '#8b949e';
  }
}
