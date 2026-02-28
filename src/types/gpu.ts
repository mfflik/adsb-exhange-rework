// WebGPU type augmentations for strict TypeScript
export interface GpuContext {
  readonly device: GPUDevice;
  readonly adapter: GPUAdapter;
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
}

export interface GpuBuffer {
  readonly buffer: GPUBuffer;
  readonly size: number;
}

export interface UniformData {
  // mat4 view-projection (16 floats)
  viewProj: Float32Array;
  // vec4 camera position
  cameraPos: Float32Array;
  // float time, float selected id, float mode (0=3d, 1=2d), float pad
  params: Float32Array;
}
