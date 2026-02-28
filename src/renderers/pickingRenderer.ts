import type { GpuContext } from '../types/gpu.ts';
import { AIRCRAFT_INSTANCE_BYTES } from '../types/aircraft.ts';
import { createUniformBuffer } from '../gpu/device.ts';
import pickingWgsl from '../shaders/picking.wgsl?raw';

const MAX_AIRCRAFT = 15000;
const PICK_TEXTURE_SIZE = 1; // We only need to read 1 pixel

export class PickingRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private pickTexture: GPUTexture | null = null;
  private pickDepthTexture: GPUTexture | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private width = 1;
  private height = 1;

  async init(ctx: GpuContext): Promise<void> {
    const { device } = ctx;

    this.uniformBuffer = createUniformBuffer(device, 256);

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: pickingWgsl });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_pick',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_pick',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Readback buffer (4 bytes for RGBA pixel)
    this.readbackBuffer = device.createBuffer({
      size: 256, // aligned
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  resize(device: GPUDevice, width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;

    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();

    this.pickTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.pickDepthTexture = device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  updateBindGroup(device: GPUDevice, instanceBuffer: GPUBuffer): void {
    if (!this.bindGroupLayout || !this.uniformBuffer) return;
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: instanceBuffer } },
      ],
    });
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

  async pick(
    device: GPUDevice,
    instanceCount: number,
    pixelX: number,
    pixelY: number
  ): Promise<number> {
    if (
      !this.pipeline ||
      !this.bindGroup ||
      !this.pickTexture ||
      !this.pickDepthTexture ||
      !this.readbackBuffer ||
      instanceCount === 0
    ) {
      return -1;
    }

    const clampedX = Math.max(0, Math.min(this.width - 1, Math.floor(pixelX)));
    const clampedY = Math.max(0, Math.min(this.height - 1, Math.floor(pixelY)));

    const encoder = device.createCommandEncoder();

    // Render picking pass
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pickTexture.createView(),
          clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }, // white = no selection
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.pickDepthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, instanceCount, 0, 0);
    pass.end();

    // Copy pixel to readback buffer
    encoder.copyTextureToBuffer(
      { texture: this.pickTexture, origin: { x: clampedX, y: clampedY } },
      { buffer: this.readbackBuffer, bytesPerRow: 256 },
      { width: 1, height: 1 }
    );

    device.queue.submit([encoder.finish()]);

    // Read back
    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(this.readbackBuffer.getMappedRange());
    const r = data[0] ?? 255;
    const g = data[1] ?? 255;
    const b = data[2] ?? 255;
    this.readbackBuffer.unmap();

    // White pixel = no aircraft
    if (r === 255 && g === 255 && b === 255) return -1;

    // Decode instance ID from RGB
    const id = (r << 16) | (g << 8) | b;
    return id;
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();
    this.readbackBuffer?.destroy();
  }
}
