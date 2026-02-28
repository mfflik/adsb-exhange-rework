import { initGpu, WebGPUNotSupportedError } from './gpu/device.ts';
import { GlobeRenderer } from './renderers/globeRenderer.ts';
import { FlatMapRenderer } from './renderers/flatMapRenderer.ts';
import { AircraftRenderer } from './renderers/aircraftRenderer.ts';
import { PickingRenderer } from './renderers/pickingRenderer.ts';
import { CameraController } from './camera/cameraController.ts';
import { AdsbClient } from './data/adsbClient.ts';
import { TileCache } from './tiles/tileCache.ts';
import { TileCompositor } from './tiles/tileCompositor.ts';
import { HudUI } from './ui/hud.ts';
import type { GpuContext } from './types/gpu.ts';
import type { Aircraft, AircraftFilter } from './types/aircraft.ts';
import { defaultFilter } from './types/aircraft.ts';
import type { Camera2D } from './types/camera.ts';
import { defaultCamera3D, defaultCamera2D } from './types/camera.ts';

export class App {
  private ctx!: GpuContext;
  private globeRenderer!: GlobeRenderer;
  private flatMapRenderer!: FlatMapRenderer;
  private aircraftRenderer!: AircraftRenderer;
  private pickingRenderer!: PickingRenderer;
  private cameraController!: CameraController;
  private adsbClient!: AdsbClient;
  private tileCache!: TileCache;
  private tileCompositor!: TileCompositor;
  private hud!: HudUI;

  private allAircraft: readonly Aircraft[] = [];
  private filteredAircraft: readonly Aircraft[] = [];
  private selectedIcao: string | null = null;
  private filter: AircraftFilter = defaultFilter();
  private viewMode: '3d' | '2d' = '3d';

  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;
  private gpuMs = 0;
  private jsMs = 0;
  private startTime = 0;
  private animFrameId = 0;

  private isPicking = false;
  private pendingPickX = 0;
  private pendingPickY = 0;
  private hasPendingPick = false;

  // Touch tracking
  private lastTouchDist = 0;

  async init(canvas: HTMLCanvasElement, hudContainer: HTMLElement): Promise<void> {
    this.startTime = performance.now();

    // Initialize WebGPU
    this.ctx = await initGpu(canvas);

    // Initialize renderers
    this.globeRenderer = new GlobeRenderer();
    this.flatMapRenderer = new FlatMapRenderer();
    this.aircraftRenderer = new AircraftRenderer();
    this.pickingRenderer = new PickingRenderer();

    await Promise.all([
      this.globeRenderer.init(this.ctx),
      this.flatMapRenderer.init(this.ctx),
      this.aircraftRenderer.init(this.ctx),
      this.pickingRenderer.init(this.ctx),
    ]);

    // Initialize camera
    this.cameraController = new CameraController(defaultCamera3D());

    // Initialize tile system
    this.tileCache = new TileCache();
    this.tileCompositor = new TileCompositor(this.tileCache);

    // Initialize HUD
    this.hud = new HudUI(hudContainer, this.filter);
    this.hud.onModeToggleClick(() => this.toggleViewMode());
    this.hud.onFilterUpdate((f) => {
      this.filter = f;
      this.applyFilter();
    });
    this.hud.onResetClick(() => {
      this.cameraController.resetCamera();
      this.selectedIcao = null;
    });

    // Initialize ADS-B client
    this.adsbClient = new AdsbClient();
    this.adsbClient.start((aircraft) => {
      this.allAircraft = aircraft;
      this.applyFilter();
    });

    // Setup canvas events
    this.setupEvents(canvas);

    // Handle resize
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    // Start render loop
    this.lastFpsTime = performance.now();
    this.renderLoop();
  }

  private handleResize(): void {
    const canvas = this.ctx.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    this.cameraController.resize(w, h);
    this.pickingRenderer.resize(this.ctx.device, w, h);
  }

  private toggleViewMode(): void {
    if (this.viewMode === '3d') {
      this.viewMode = '2d';
      this.cameraController.setCamera(defaultCamera2D());
    } else {
      this.viewMode = '3d';
      this.cameraController.setCamera(defaultCamera3D());
    }
  }

  private applyFilter(): void {
    const f = this.filter;
    this.filteredAircraft = this.allAircraft.filter((ac) => {
      if (ac.altitudeFt < f.minAltitudeFt || ac.altitudeFt > f.maxAltitudeFt) return false;
      if (!f.categories.has(ac.category)) return false;
      if (f.searchCallsign && !ac.callsign.toLowerCase().includes(f.searchCallsign.toLowerCase())) return false;
      return true;
    });
  }

  private setupEvents(canvas: HTMLCanvasElement): void {
    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
      this.cameraController.onMouseDown(e.clientX, e.clientY);
    });

    canvas.addEventListener('mousemove', (e) => {
      this.cameraController.onMouseMove(e.clientX, e.clientY);
    });

    canvas.addEventListener('mouseup', () => {
      this.cameraController.onMouseUp();
    });

    canvas.addEventListener('mouseleave', () => {
      this.cameraController.onMouseUp();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraController.onWheel(e.deltaY);
    }, { passive: false });

    // Click for picking
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.pendingPickX = (e.clientX - rect.left) * dpr;
      this.pendingPickY = (e.clientY - rect.top) * dpr;
      this.hasPendingPick = true;
    });

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (t) this.cameraController.onMouseDown(t.clientX, t.clientY);
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (t0 && t1) {
          this.lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (t) this.cameraController.onMouseMove(t.clientX, t.clientY);
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (t0 && t1) {
          const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          if (this.lastTouchDist > 0) {
            this.cameraController.onPinch(dist / this.lastTouchDist);
          }
          this.lastTouchDist = dist;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      this.cameraController.onMouseUp();
      this.lastTouchDist = 0;
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        this.cameraController.resetCamera();
        this.selectedIcao = null;
      }
      if (e.key === 'Escape') {
        this.selectedIcao = null;
      }
    });
  }

  private async renderLoop(): Promise<void> {
    const jsStart = performance.now();

    const { device, context, canvas } = this.ctx;
    const w = canvas.width;
    const h = canvas.height;

    if (w === 0 || h === 0) {
      this.animFrameId = requestAnimationFrame(() => void this.renderLoop());
      return;
    }

    const time = (performance.now() - this.startTime) / 1000;
    const camera = this.cameraController.getCamera();
    const { viewProj, cameraPos } = this.cameraController.computeMatrices();

    // Update tile compositor for globe texture
    const tileZoom = camera.mode === '2d'
      ? (camera as Camera2D).zoom
      : Math.max(1, Math.min(5, 8 - Math.log2(1)));

    const centerLon = camera.mode === '2d' ? (camera as Camera2D).centerLon : 0;
    const centerLat = camera.mode === '2d' ? (camera as Camera2D).centerLat : 20;

    const tileTexture = await this.tileCompositor.update(device, centerLon, centerLat, tileZoom);

    // Update globe/map texture
    if (camera.mode === '3d') {
      this.globeRenderer.updateTexture(device, tileTexture);
    } else {
      this.flatMapRenderer.updateTexture(device, tileTexture);
    }

    // Build uniform data
    const params = new Float32Array([
      time,
      this.selectedIcao ? 1.0 : 0.0,
      camera.mode === '3d' ? 0.0 : 1.0,
      w / h, // aspect ratio
    ]);

    const viewProjF32 = new Float32Array(viewProj);
    const cameraPosF32 = new Float32Array([cameraPos[0], cameraPos[1], cameraPos[2], 1.0]);

    // Update aircraft instances
    this.aircraftRenderer.updateAircraft(
      device,
      this.filteredAircraft,
      this.selectedIcao,
      camera.mode
    );

    // Update uniforms
    this.globeRenderer.updateUniforms(device, viewProjF32, cameraPosF32, params);
    this.flatMapRenderer.updateUniforms(
      device, viewProjF32, cameraPosF32, params,
      new Float32Array([centerLon, centerLat, tileZoom, 0])
    );
    this.aircraftRenderer.updateUniforms(device, viewProjF32, cameraPosF32, params);
    this.pickingRenderer.updateUniforms(device, viewProjF32, cameraPosF32, params);

    // Handle pending pick
    if (this.hasPendingPick && !this.isPicking) {
      this.hasPendingPick = false;
      this.isPicking = true;
      const px = this.pendingPickX;
      const py = this.pendingPickY;

      // Update picking bind group with current instance buffer
      const instanceBuffer = (this.aircraftRenderer as unknown as { instanceBuffer: GPUBuffer | null }).instanceBuffer;
      if (instanceBuffer) {
        this.pickingRenderer.updateBindGroup(device, instanceBuffer);
      }

      this.pickingRenderer.pick(
        device,
        this.aircraftRenderer.getInstanceCount(),
        px, py
      ).then((instanceIdx) => {
        this.isPicking = false;
        if (instanceIdx >= 0 && instanceIdx < this.filteredAircraft.length) {
          const ac = this.filteredAircraft[instanceIdx];
          if (ac) {
            this.selectedIcao = this.selectedIcao === ac.icao24 ? null : ac.icao24;
          }
        } else {
          this.selectedIcao = null;
        }
      }).catch(() => {
        this.isPicking = false;
      });
    }

    // Get depth texture
    const depthTexture = this.globeRenderer.ensureDepthTexture(device, w, h);
    const depthView = depthTexture.createView();

    // Get color texture
    const colorTexture = context.getCurrentTexture();
    const colorView = colorTexture.createView();

    // Render
    const encoder = device.createCommandEncoder();

    if (camera.mode === '3d') {
      this.globeRenderer.render(encoder, colorView, depthView);
      this.aircraftRenderer.render(encoder, colorView, depthView, 'load');
    } else {
      this.flatMapRenderer.render(encoder, colorView);
      // For 2D, we need a depth texture too
      this.aircraftRenderer.render(encoder, colorView, depthView, 'load');
    }

    device.queue.submit([encoder.finish()]);

    // FPS tracking
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 500) {
      this.fps = (this.frameCount / elapsed) * 1000;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    this.jsMs = performance.now() - jsStart;

    // Update HUD
    const selectedAc = this.selectedIcao
      ? this.filteredAircraft.find((a) => a.icao24 === this.selectedIcao) ?? null
      : null;

    this.hud.update({
      selectedAircraft: selectedAc,
      aircraftCount: this.allAircraft.length,
      filteredCount: this.filteredAircraft.length,
      fps: this.fps,
      gpuMs: this.gpuMs,
      jsMs: this.jsMs,
      isSimulating: this.adsbClient.isUsingSimulation(),
      viewMode: camera.mode,
      filter: this.filter,
    });

    this.animFrameId = requestAnimationFrame(() => void this.renderLoop());
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    this.adsbClient.stop();
    this.globeRenderer.destroy();
    this.flatMapRenderer.destroy();
    this.aircraftRenderer.destroy();
    this.pickingRenderer.destroy();
    this.tileCompositor.destroy();
  }
}
