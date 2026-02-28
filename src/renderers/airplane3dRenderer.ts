// 3D Airplane instanced renderer
// Renders actual 3D airplane mesh objects on the globe surface

import type { GpuContext } from '../types/gpu.ts';
import type { Aircraft, AircraftCategory } from '../types/aircraft.ts';
import { generateAirplane3D } from '../geometry/airplane3d.ts';
import { createBuffer, createUniformBuffer } from '../gpu/device.ts';
import { latLonToXYZ, DEG2RAD } from '../utils/math.ts';
import airplane3dWgsl from '../shaders/airplane3d.wgsl?raw';

// Per-instance data: 4x vec4 = 16 floats
const INSTANCE_FLOATS = 16;
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
const MAX_AIRCRAFT = 15000;

// Airplane scale on globe (1.0 = unit sphere radius)
// At zoom ~2.5 distance, this gives ~8-12 pixel size
const BASE_SCALE = 0.012;

const CATEGORY_COLORS: Record<AircraftCategory, [number, number, number]> = {
  friend: [0.0, 0.9, 1.0],    // Cyan
  hostile: [1.0, 0.2, 0.2],   // Red
  neutral: [0.2, 1.0, 0.3],   // Green
  unknown: [1.0, 0.9, 0.1],   // Yellow
  civilian: [1.0, 0.2, 1.0],  // Magenta
};

export class Airplane3DRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private indexCount = 0;
  private instanceCount = 0;
  private readonly instanceArrayBuffer: ArrayBuffer;
  private readonly instanceData: Float32Array<ArrayBuffer>;

  constructor() {
    this.instanceArrayBuffer = new ArrayBuffer(MAX_AIRCRAFT * INSTANCE_BYTES);
    this.instanceData = new Float32Array(this.instanceArrayBuffer);
  }

  async init(ctx: GpuContext): Promise<void> {
    const { device, format } = ctx;

    // Generate airplane geometry
    const geo = generateAirplane3D();
    this.indexCount = geo.indexCount;

    this.vertexBuffer = createBuffer(device, geo.vertices, GPUBufferUsage.VERTEX);
    this.indexBuffer = createBuffer(device, geo.indices, GPUBufferUsage.INDEX);
    this.uniformBuffer = createUniformBuffer(device, 256);

    this.instanceBuffer = device.createBuffer({
      size: MAX_AIRCRAFT * INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: airplane3dWgsl });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_airplane',
        buffers: [
          {
            arrayStride: 6 * 4, // pos(3) + normal(3)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_airplane',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  updateAircraft(
    device: GPUDevice,
    aircraft: readonly Aircraft[],
    selectedIcao: string | null,
    cameraDistance: number
  ): void {
    const count = Math.min(aircraft.length, MAX_AIRCRAFT);
    this.instanceCount = count;

    // Scale airplane based on camera distance for consistent screen size
    const scale = BASE_SCALE * (cameraDistance / 2.5);

    for (let i = 0; i < count; i++) {
      const ac = aircraft[i];
      if (!ac) continue;

      const base = i * INSTANCE_FLOATS;
      const isSelected = ac.icao24 === selectedIcao ? 1.0 : 0.0;
      const color = CATEGORY_COLORS[ac.category] ?? [1, 1, 0];

      // Position on globe surface (slightly above)
      const r = 1.003 + (ac.altitudeFt / 100000) * 0.008;
      const pos = latLonToXYZ(ac.lat, ac.lon);
      const wx = pos[0] * r;
      const wy = pos[1] * r;
      const wz = pos[2] * r;

      // Up vector = radial direction from globe center
      const upX = pos[0];
      const upY = pos[1];
      const upZ = pos[2];

      // Forward vector = track direction on sphere surface
      // Track is measured clockwise from North
      // North on sphere at this point: derivative of position w.r.t. latitude
      const latRad = ac.lat * DEG2RAD;
      const lonRad = ac.lon * DEG2RAD;
      const trackRad = ac.trackDeg * DEG2RAD;

      // North direction (tangent to sphere pointing toward north pole)
      const northX = -Math.sin(latRad) * Math.sin(lonRad);
      const northY = Math.cos(latRad);
      const northZ = -Math.sin(latRad) * Math.cos(lonRad);

      // East direction (tangent to sphere pointing east)
      const eastX = Math.cos(lonRad);
      const eastY = 0;
      const eastZ = -Math.sin(lonRad);

      // Forward = north * cos(track) + east * sin(track)
      const fwdX = northX * Math.cos(trackRad) + eastX * Math.sin(trackRad);
      const fwdY = northY * Math.cos(trackRad) + eastY * Math.sin(trackRad);
      const fwdZ = northZ * Math.cos(trackRad) + eastZ * Math.sin(trackRad);

      // posTrack: xyz=world pos, w=trackRad
      this.instanceData[base + 0] = wx;
      this.instanceData[base + 1] = wy;
      this.instanceData[base + 2] = wz;
      this.instanceData[base + 3] = trackRad;

      // colorSelected: xyz=color, w=selected
      this.instanceData[base + 4] = color[0] ?? 1;
      this.instanceData[base + 5] = color[1] ?? 1;
      this.instanceData[base + 6] = color[2] ?? 0;
      this.instanceData[base + 7] = isSelected;

      // upVec: xyz=up, w=instanceId
      this.instanceData[base + 8] = upX;
      this.instanceData[base + 9] = upY;
      this.instanceData[base + 10] = upZ;
      this.instanceData[base + 11] = i;

      // forwardScale: xyz=forward, w=scale
      this.instanceData[base + 12] = fwdX;
      this.instanceData[base + 13] = fwdY;
      this.instanceData[base + 14] = fwdZ;
      this.instanceData[base + 15] = scale;
    }

    if (count > 0 && this.instanceBuffer) {
      device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.instanceData,
        0,
        count * INSTANCE_FLOATS
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
    if (!this.pipeline || !this.bindGroup || !this.vertexBuffer || !this.indexBuffer || this.instanceCount === 0) return;

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
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint16');
    pass.drawIndexed(this.indexCount, this.instanceCount, 0, 0, 0);
    pass.end();
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
  }
}
