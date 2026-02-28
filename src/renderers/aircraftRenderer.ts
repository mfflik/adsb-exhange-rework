import type { GpuContext } from '../types/gpu.ts';
import type { Aircraft, AircraftCategory } from '../types/aircraft.ts';
import { AIRCRAFT_INSTANCE_FLOATS, AIRCRAFT_INSTANCE_BYTES } from '../types/aircraft.ts';
import { latLonToXYZ, DEG2RAD, mercatorUV } from '../utils/math.ts';
import { createUniformBuffer } from '../gpu/device.ts';
import aircraftWgsl from '../shaders/aircraft.wgsl?raw';

// Category color map
const CATEGORY_COLORS: Record<AircraftCategory, [number, number, number]> = {
  friend: [0.0, 1.0, 1.0],    // Cyan
  hostile: [1.0, 0.2, 0.2],   // Red
  neutral: [0.2, 1.0, 0.3],   // Green
  unknown: [1.0, 0.9, 0.1],   // Yellow
  civilian: [1.0, 0.2, 1.0],  // Magenta
};

const CATEGORY_IDS: Record<AircraftCategory, number> = {
  friend: 0,
  hostile: 1,
  neutral: 2,
  unknown: 3,
  civilian: 4,
};

const MAX_AIRCRAFT = 15000;

export class AircraftRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private instanceCount = 0;
  private readonly instanceArrayBuffer: ArrayBuffer;
  private instanceData: Float32Array<ArrayBuffer>;

  constructor() {
    // Pre-allocate instance buffer (use ArrayBuffer directly for WebGPU compat)
    this.instanceArrayBuffer = new ArrayBuffer(MAX_AIRCRAFT * AIRCRAFT_INSTANCE_BYTES);
    this.instanceData = new Float32Array(this.instanceArrayBuffer);
  }

  async init(ctx: GpuContext): Promise<void> {
    const { device, format } = ctx;

    this.uniformBuffer = createUniformBuffer(device, 256);

    // Create instance storage buffer
    this.instanceBuffer = device.createBuffer({
      size: MAX_AIRCRAFT * AIRCRAFT_INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: aircraftWgsl });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }

  updateAircraft(
    device: GPUDevice,
    aircraft: readonly Aircraft[],
    selectedIcao: string | null,
    mode: '3d' | '2d'
  ): void {
    const count = Math.min(aircraft.length, MAX_AIRCRAFT);
    this.instanceCount = count;

    for (let i = 0; i < count; i++) {
      const ac = aircraft[i];
      if (!ac) continue;

      const base = i * AIRCRAFT_INSTANCE_FLOATS;
      const isSelected = ac.icao24 === selectedIcao ? 1.0 : 0.0;
      const color = CATEGORY_COLORS[ac.category] ?? [1, 1, 0];
      const catId = CATEGORY_IDS[ac.category] ?? 3;
      const trackRad = ac.trackDeg * DEG2RAD;

      if (mode === '3d') {
        // 3D: position on unit sphere surface
        const pos = latLonToXYZ(ac.lat, ac.lon);
        // Slightly above surface
        const r = 1.002 + (ac.altitudeFt / 100000) * 0.01;
        this.instanceData[base + 0] = pos[0] * r;
        this.instanceData[base + 1] = pos[1] * r;
        this.instanceData[base + 2] = pos[2] * r;
      } else {
        // 2D: Mercator position
        const [u, v] = mercatorUV(ac.lat, ac.lon);
        this.instanceData[base + 0] = (u * 2 - 1) * 180; // lon
        this.instanceData[base + 1] = (1 - v * 2) * 90;  // lat approx
        this.instanceData[base + 2] = 0.5;
      }

      this.instanceData[base + 3] = trackRad;
      this.instanceData[base + 4] = color[0] ?? 1;
      this.instanceData[base + 5] = color[1] ?? 1;
      this.instanceData[base + 6] = color[2] ?? 0;
      this.instanceData[base + 7] = catId;
      this.instanceData[base + 8] = isSelected;
      this.instanceData[base + 9] = i; // instance ID for picking
      this.instanceData[base + 10] = 0;
      this.instanceData[base + 11] = 0;
    }

    if (count > 0 && this.instanceBuffer) {
      device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.instanceData,
        0,
        count * AIRCRAFT_INSTANCE_FLOATS
      );
    }
  }

  updateUniforms(
    device: GPUDevice,
    viewProj: Float32Array,
    cameraPos: Float32Array,
    params: Float32Array
  ): void {
    if (!this.uniformBuffer) return;
    const data = new Float32Array(16 + 4 + 4);
    data.set(viewProj, 0);
    data.set(cameraPos, 16);
    data.set(params, 20);
    device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    depthView: GPUTextureView,
    loadOp: GPULoadOp = 'load'
  ): void {
    if (!this.pipeline || !this.bindGroup || this.instanceCount === 0) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          loadOp,
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    // 6 vertices per instance (2 triangles = 1 quad)
    pass.draw(6, this.instanceCount, 0, 0);
    pass.end();
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
  }
}
