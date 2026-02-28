import type { GpuContext } from '../types/gpu.ts';
import { createUniformBuffer } from '../gpu/device.ts';
import flatmapWgsl from '../shaders/flatmap.wgsl?raw';

export class FlatMapRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;

  async init(ctx: GpuContext): Promise<void> {
    const { device, format } = ctx;

    this.uniformBuffer = createUniformBuffer(device, 256);

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

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.texture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });

    const shaderModule = device.createShaderModule({ code: flatmapWgsl });
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
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  updateTexture(device: GPUDevice, newTexture: GPUTexture): void {
    if (!this.bindGroupLayout || !this.uniformBuffer || !this.sampler) return;

    this.texture = newTexture;
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.texture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  updateUniforms(device: GPUDevice, viewProj: Float32Array, cameraPos: Float32Array, params: Float32Array, mapParams: Float32Array): void {
    if (!this.uniformBuffer) return;
    const data = new Float32Array(16 + 4 + 4 + 4);
    data.set(viewProj, 0);
    data.set(cameraPos, 16);
    data.set(params, 20);
    data.set(mapParams, 24);
    device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(encoder: GPUCommandEncoder, colorView: GPUTextureView): void {
    if (!this.pipeline || !this.bindGroup) return;

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
    pass.draw(6); // Full-screen quad (2 triangles)
    pass.end();
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
  }
}
