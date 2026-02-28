import type { Camera, Camera3D, Camera2D } from '../types/camera.ts';
import {
  quatFromAxisAngle, quatMul, quatNormalize, quatRotateVec3, quatConjugate,
  vec3Normalize, vec3Cross, vec3Dot,
  mat4Perspective, mat4LookAt, mat4Mul, mat4Ortho, mat4FromQuat,
  clamp, DEG2RAD,
  type Vec3, type Mat4, type Quat,
} from '../utils/math.ts';

export interface CameraMatrices {
  readonly viewProj: Mat4;
  readonly cameraPos: Vec3;
}

export class CameraController {
  private camera: Camera;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private width = 1;
  private height = 1;

  constructor(initialCamera: Camera) {
    this.camera = initialCamera;
  }

  getCamera(): Camera {
    return this.camera;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  onMouseDown(x: number, y: number): void {
    this.isDragging = true;
    this.lastMouseX = x;
    this.lastMouseY = y;
  }

  onMouseMove(x: number, y: number): void {
    if (!this.isDragging) return;

    const dx = x - this.lastMouseX;
    const dy = y - this.lastMouseY;
    this.lastMouseX = x;
    this.lastMouseY = y;

    if (this.camera.mode === '3d') {
      this.orbit3D(dx, dy);
    } else {
      this.pan2D(dx, dy);
    }
  }

  onMouseUp(): void {
    this.isDragging = false;
  }

  onWheel(delta: number): void {
    if (this.camera.mode === '3d') {
      const cam = this.camera as Camera3D;
      const newFov = clamp(cam.fovDeg + delta * 0.05, 5, 90);
      this.camera = { ...cam, fovDeg: newFov };
    } else {
      const cam = this.camera as Camera2D;
      const newZoom = clamp(cam.zoom - delta * 0.005, 1, 18);
      this.camera = { ...cam, zoom: newZoom };
    }
  }

  onPinch(scale: number): void {
    if (this.camera.mode === '3d') {
      const cam = this.camera as Camera3D;
      const newFov = clamp(cam.fovDeg / scale, 5, 90);
      this.camera = { ...cam, fovDeg: newFov };
    } else {
      const cam = this.camera as Camera2D;
      const newZoom = clamp(cam.zoom + Math.log2(scale), 1, 18);
      this.camera = { ...cam, zoom: newZoom };
    }
  }

  resetCamera(): void {
    if (this.camera.mode === '3d') {
      this.camera = {
        mode: '3d',
        qx: 0, qy: 0, qz: 0, qw: 1,
        fovDeg: 45,
        distance: 2.5,
      };
    } else {
      this.camera = {
        mode: '2d',
        centerLon: 0,
        centerLat: 20,
        zoom: 3,
      };
    }
  }

  private orbit3D(dx: number, dy: number): void {
    const cam = this.camera as Camera3D;
    const sensitivity = 0.005;

    // Rotate around Y axis (longitude)
    const qY = quatFromAxisAngle([0, 1, 0], -dx * sensitivity);
    // Rotate around X axis (latitude) in camera space
    const qX = quatFromAxisAngle([1, 0, 0], -dy * sensitivity);

    const currentQ: Quat = [cam.qx, cam.qy, cam.qz, cam.qw];
    const newQ = quatNormalize(quatMul(quatMul(qY, currentQ), qX));

    this.camera = {
      ...cam,
      qx: newQ[0],
      qy: newQ[1],
      qz: newQ[2],
      qw: newQ[3],
    };
  }

  private pan2D(dx: number, dy: number): void {
    const cam = this.camera as Camera2D;
    const scale = 360 / (Math.pow(2, cam.zoom) * 256);
    const newLon = cam.centerLon - dx * scale;
    const newLat = clamp(cam.centerLat + dy * scale, -85, 85);
    this.camera = { ...cam, centerLon: newLon, centerLat: newLat };
  }

  computeMatrices(): CameraMatrices {
    if (this.camera.mode === '3d') {
      return this.compute3DMatrices(this.camera as Camera3D);
    } else {
      return this.compute2DMatrices(this.camera as Camera2D);
    }
  }

  private compute3DMatrices(cam: Camera3D): CameraMatrices {
    const aspect = this.width / this.height;
    const fovRad = cam.fovDeg * DEG2RAD;
    const proj = mat4Perspective(fovRad, aspect, 0.01, 100);

    // Camera position: rotate [0, 0, distance] by inverse quaternion
    const q: Quat = [cam.qx, cam.qy, cam.qz, cam.qw];
    const qInv = quatConjugate(q);
    const cameraPos = quatRotateVec3(qInv, [0, 0, cam.distance]);

    const view = mat4LookAt(cameraPos, [0, 0, 0], [0, 1, 0]);
    const viewProj = mat4Mul(proj, view);

    return { viewProj, cameraPos };
  }

  private compute2DMatrices(cam: Camera2D): CameraMatrices {
    const aspect = this.width / this.height;
    // Orthographic projection for 2D
    const scale = 360 / Math.pow(2, cam.zoom);
    const halfW = scale * aspect * 0.5;
    const halfH = scale * 0.5;

    const proj = mat4Ortho(
      cam.centerLon - halfW,
      cam.centerLon + halfW,
      cam.centerLat - halfH,
      cam.centerLat + halfH,
      -1, 1
    );

    const viewProj = proj;
    const cameraPos: Vec3 = [cam.centerLon, cam.centerLat, 1];

    return { viewProj, cameraPos };
  }

  /** Convert screen coordinates to world ray for picking */
  screenToRay(screenX: number, screenY: number): { origin: Vec3; dir: Vec3 } | null {
    if (this.camera.mode !== '3d') return null;

    const cam = this.camera as Camera3D;
    const q: Quat = [cam.qx, cam.qy, cam.qz, cam.qw];
    const qInv = quatConjugate(q);
    const cameraPos = quatRotateVec3(qInv, [0, 0, cam.distance]);

    // NDC coordinates
    const ndcX = (screenX / this.width) * 2 - 1;
    const ndcY = 1 - (screenY / this.height) * 2;

    const aspect = this.width / this.height;
    const fovRad = cam.fovDeg * DEG2RAD;
    const tanHalfFov = Math.tan(fovRad * 0.5);

    // Ray direction in view space
    const rayView: Vec3 = [
      ndcX * aspect * tanHalfFov,
      ndcY * tanHalfFov,
      -1,
    ];

    // Transform to world space using camera orientation
    const forward = vec3Normalize(quatRotateVec3(qInv, [0, 0, -1]));
    const right = vec3Normalize(quatRotateVec3(qInv, [1, 0, 0]));
    const up = vec3Normalize(quatRotateVec3(qInv, [0, 1, 0]));

    const rayWorld: Vec3 = [
      right[0] * rayView[0] + up[0] * rayView[1] + forward[0] * rayView[2],
      right[1] * rayView[0] + up[1] * rayView[1] + forward[1] * rayView[2],
      right[2] * rayView[0] + up[2] * rayView[1] + forward[2] * rayView[2],
    ];

    return {
      origin: cameraPos,
      dir: vec3Normalize(rayWorld),
    };
  }
}
