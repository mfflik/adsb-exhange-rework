// WebGPU 2D OSM tile renderer
// Renders individual tiles as textured quads using the tile atlas

import type { GpuContext } from '../types/gpu.ts';
import { createUniformBuffer } from '../gpu/device.ts';
import tile2dWgsl from '../shaders/tile2d.wgsl?raw';

// Each tile instance: [tileX, tileY, tileZ, pad, u0, v0, u1, v1] = 8 floats
const TILE_INSTANCE_FLOATS = 8;
const TILE_INSTANCE_BYTES = TILE_INSTANCE_FLOATS * 4;
const MAX_TILES = 256;

// Atlas is 8x8 tiles
const ATLAS_TILES = 8;

export class Tile2DRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private tileInstanceBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private tileCount = 0;
  private readonly tileData: Float32Array<ArrayBuffer>;

  constructor() {
    const buf = new ArrayBuffer(MAX_TILES * TILE_INSTANCE_BYTES);
    this.tileData = new Float32Array(buf);
  }

  async init(ctx: GpuContext): Promise<void> {
    const { device, format } = ctx;

    this.uniformBuffer = createUniformBuffer(device, 64);

    // Placeholder texture
    this.texture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.texture },
      new Uint8Array([10, 16, 40, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.tileInstanceBuffer = device.createBuffer({
      size: MAX_TILES * TILE_INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.bindGroup = this.createBindGroup(device);

    const shaderModule = device.createShaderModule({ code: tile2dWgsl });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_tile',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_tile',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createBindGroup(device: GPUDevice): GPUBindGroup {
    if (!this.bindGroupLayout || !this.uniformBuffer || !this.texture || !this.sampler || !this.tileInstanceBuffer) {
      throw new Error('Tile2DRenderer not initialized');
    }
    return device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.texture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.tileInstanceBuffer } },
      ],
    });
  }

  updateAtlasTexture(device: GPUDevice, atlasTexture: GPUTexture): void {
    if (!this.bindGroupLayout || !this.uniformBuffer || !this.sampler || !this.tileInstanceBuffer) return;
    this.texture = atlasTexture;
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.texture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.tileInstanceBuffer } },
      ],
    });
  }

  updateTiles(
    device: GPUDevice,
    centerLon: number,
    centerLat: number,
    zoom: number,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    if (!this.uniformBuffer || !this.tileInstanceBuffer) return;

    const aspect = canvasWidth / canvasHeight;

    // Update uniforms
    const uniforms = new Float32Array([
      centerLon, centerLat, zoom, aspect,
      canvasWidth, canvasHeight, 0, 0,
    ]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Build tile instances for the atlas
    // The atlas is 8x8 tiles centered on the view
    const z = Math.max(0, Math.min(19, Math.floor(zoom)));
    const n = Math.pow(2, z);

    // Center tile
    const centerTileX = Math.floor(((centerLon + 180) / 360) * n);
    const latRad = centerLat * (Math.PI / 180);
    const centerTileY = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );

    const half = Math.floor(ATLAS_TILES / 2);
    let count = 0;

    for (let dy = 0; dy < ATLAS_TILES && count < MAX_TILES; dy++) {
      for (let dx = 0; dx < ATLAS_TILES && count < MAX_TILES; dx++) {
        const tileX = centerTileX - half + dx;
        const tileY = centerTileY - half + dy;

        // Wrap X
        const wrappedX = ((tileX % n) + n) % n;
        // Clamp Y
        const clampedY = Math.max(0, Math.min(n - 1, tileY));

        // UV in atlas (each tile is 1/ATLAS_TILES of the atlas)
        const u0 = dx / ATLAS_TILES;
        const v0 = dy / ATLAS_TILES;
        const u1 = (dx + 1) / ATLAS_TILES;
        const v1 = (dy + 1) / ATLAS_TILES;

        const base = count * TILE_INSTANCE_FLOATS;
        this.tileData[base + 0] = wrappedX;
        this.tileData[base + 1] = clampedY;
        this.tileData[base + 2] = z;
        this.tileData[base + 3] = 0;
        this.tileData[base + 4] = u0;
        this.tileData[base + 5] = v0;
        this.tileData[base + 6] = u1;
        this.tileData[base + 7] = v1;
        count++;
      }
    }

    this.tileCount = count;

    if (count > 0) {
      device.queue.writeBuffer(
        this.tileInstanceBuffer,
        0,
        this.tileData,
        0,
        count * TILE_INSTANCE_FLOATS
      );
    }
  }

  render(encoder: GPUCommandEncoder, colorView: GPUTextureView): void {
    if (!this.pipeline || !this.bindGroup || this.tileCount === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.tileCount, 0, 0);
    pass.end();
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.tileInstanceBuffer?.destroy();
  }
}
