import type { GpuContext } from '../types/gpu.ts';
import { generateIcosphere } from '../geometry/icosphere.ts';
import { createBuffer, createUniformBuffer, createDepthTexture } from '../gpu/device.ts';
import globeWgsl from '../shaders/globe.wgsl?raw';

export class GlobeRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;
  private indexCount = 0;
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  async init(ctx: GpuContext): Promise<void> {
    const { device, format } = ctx;

    // Generate icosphere geometry (4 subdivisions = ~5k vertices)
    const geo = generateIcosphere(4);
    this.indexCount = geo.indexCount;

    this.vertexBuffer = createBuffer(device, geo.vertices, GPUBufferUsage.VERTEX);
    this.indexBuffer = createBuffer(device, geo.indices, GPUBufferUsage.INDEX);
    this.uniformBuffer = createUniformBuffer(device, 256);

    // Create placeholder texture (1x1 dark blue)
    this.texture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.texture },
      new Uint8Array([5, 8, 20, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
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

    const shaderModule = device.createShaderModule({ code: globeWgsl });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8 * 4, // 8 floats per vertex
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
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

  updateUniforms(device: GPUDevice, viewProj: Float32Array, cameraPos: Float32Array, params: Float32Array): void {
    if (!this.uniformBuffer) return;
    const data = new Float32Array(16 + 4 + 4);
    data.set(viewProj, 0);
    data.set(cameraPos, 16);
    data.set(params, 20);
    device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  ensureDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
    if (
      !this.depthTexture ||
      this.depthTexture.width !== width ||
      this.depthTexture.height !== height
    ) {
      this.depthTexture?.destroy();
      this.depthTexture = createDepthTexture(device, width, height);
    }
    return this.depthTexture;
  }

  render(
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    depthView: GPUTextureView
  ): void {
    if (!this.pipeline || !this.bindGroup || !this.vertexBuffer || !this.indexBuffer) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
    pass.end();
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
  }
}
