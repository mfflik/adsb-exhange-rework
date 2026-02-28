import type { GpuContext } from '../types/gpu.ts';

export class WebGPUNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUNotSupportedError';
  }
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new WebGPUNotSupportedError(
      'WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.'
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new WebGPUNotSupportedError(
      'No WebGPU adapter found. Your GPU may not support WebGPU.'
    );
  }

  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {
      maxBufferSize: 256 * 1024 * 1024, // 256 MB
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    },
  });

  device.lost.then((info: GPUDeviceLostInfo) => {
    console.error('WebGPU device lost:', info.message, info.reason);
  });

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUNotSupportedError('Failed to get WebGPU canvas context.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { device, adapter, canvas, context, format };
}

export function createBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array | Uint16Array,
  usage: GPUBufferUsageFlags
): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(data.byteLength, 4),
    usage,
    mappedAtCreation: true,
  });

  if (data instanceof Float32Array) {
    new Float32Array(buffer.getMappedRange()).set(data);
  } else if (data instanceof Uint32Array) {
    new Uint32Array(buffer.getMappedRange()).set(data);
  } else {
    new Uint16Array(buffer.getMappedRange()).set(data);
  }

  buffer.unmap();
  return buffer;
}

export function createUniformBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: Math.ceil(size / 16) * 16, // align to 16 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function createStorageBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(size, 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

export function createDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    size: { width, height },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
