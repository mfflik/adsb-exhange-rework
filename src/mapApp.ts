// Main application for MapTalks + WebGPU refactor
// MapTalks handles the map/tiles, WebGPU renders aircraft overlay

import * as maptalks from 'maptalks';

// MapTalks event handler result type (has index signature)
type MapClickEvent = {
  containerPoint?: { x: number; y: number };
  [key: string]: unknown;
};
import { createMap, latLonToPixel, getMapBounds } from './map/mapSetup.ts';
import { AircraftOverlay, type ScreenProjector } from './renderers/aircraftOverlay.ts';
import { AdsbClient } from './data/adsbClient.ts';
import { UiController } from './ui/uiController.ts';
import type { Aircraft, AircraftFilter } from './types/aircraft.ts';
import { defaultFilter } from './types/aircraft.ts';

export class MapApp {
  private map!: maptalks.Map;
  private overlay!: AircraftOverlay;
  private adsbClient!: AdsbClient;
  private ui!: UiController;

  private allAircraft: readonly Aircraft[] = [];
  private filteredAircraft: readonly Aircraft[] = [];
  private selectedIcao: string | null = null;
  private filter: AircraftFilter = defaultFilter();

  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;
  private startTime = 0;
  private animFrameId = 0;

  async init(): Promise<void> {
    this.startTime = performance.now();

    // Create MapTalks map with OSM basemap
    const { map } = createMap('map');
    this.map = map;

    // Create WebGPU aircraft overlay
    this.overlay = new AircraftOverlay();
    this.overlay.mount(document.body);
    await this.overlay.initGpu();

    // Initialize UI
    this.ui = new UiController();
    this.ui.init();

    this.ui.onFilterUpdate((f) => {
      this.filter = f;
      this.applyFilter();
    });

    this.ui.onSelect((icao) => {
      this.selectedIcao = icao;
      if (!icao) {
        const panel = document.getElementById('detail-panel');
        if (panel) panel.style.display = 'none';
      }
    });

    this.ui.onResetView(() => {
      this.map.animateTo({ center: [0, 20], zoom: 3 }, { duration: 600 });
      this.selectedIcao = null;
    });

    // Initialize ADS-B client
    this.adsbClient = new AdsbClient();
    this.adsbClient.start((aircraft) => {
      this.allAircraft = aircraft;
      this.applyFilter();
    });

    // Handle resize
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    // Map click for aircraft picking
    this.map.on('click', (e?: MapClickEvent) => {
      const containerPoint = e?.containerPoint;
      if (!containerPoint) return;

      const projector = this.createProjector();
      const idx = this.overlay.pickAtPixel(
        this.filteredAircraft,
        projector,
        containerPoint.x,
        containerPoint.y
      );

      if (idx >= 0) {
        const ac = this.filteredAircraft[idx];
        if (ac) {
          this.selectedIcao = this.selectedIcao === ac.icao24 ? null : ac.icao24;
          if (!this.selectedIcao) {
            const panel = document.getElementById('detail-panel');
            if (panel) panel.style.display = 'none';
          }
        }
      } else {
        this.selectedIcao = null;
        const panel = document.getElementById('detail-panel');
        if (panel) panel.style.display = 'none';
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.selectedIcao = null;
        const panel = document.getElementById('detail-panel');
        if (panel) panel.style.display = 'none';
      }
    });

    // Start render loop
    this.lastFpsTime = performance.now();
    this.renderLoop();
  }

  private handleResize(): void {
    this.overlay.resize(window.innerWidth, window.innerHeight);
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

  private createProjector(): ScreenProjector {
    const map = this.map;
    return {
      latLonToPixel(lat: number, lon: number) {
        return latLonToPixel(map, lat, lon);
      },
      getBounds() {
        return getMapBounds(map);
      },
    };
  }

  private renderLoop(): void {
    const time = (performance.now() - this.startTime) / 1000;
    const zoom = this.map.getZoom();
    const projector = this.createProjector();

    // Render WebGPU aircraft overlay
    this.overlay.render(
      this.filteredAircraft,
      projector,
      this.selectedIcao,
      time,
      zoom
    );

    // FPS tracking
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 500) {
      this.fps = (this.frameCount / elapsed) * 1000;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    // Get nearby aircraft (sorted by distance to map center)
    const center = this.map.getCenter();
    const nearbyAircraft = [...this.filteredAircraft]
      .sort((a, b) => {
        const da = Math.hypot(a.lat - center.y, a.lon - center.x);
        const db = Math.hypot(b.lat - center.y, b.lon - center.x);
        return da - db;
      })
      .slice(0, 50);

    // Update UI
    const selectedAc = this.selectedIcao
      ? this.filteredAircraft.find((a) => a.icao24 === this.selectedIcao) ?? null
      : null;

    this.ui.update({
      aircraftCount: this.allAircraft.length,
      filteredCount: this.filteredAircraft.length,
      fps: this.fps,
      isSimulating: this.adsbClient.isUsingSimulation(),
      selectedAircraft: selectedAc,
      nearbyAircraft,
    });

    this.animFrameId = requestAnimationFrame(() => this.renderLoop());
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    this.adsbClient.stop();
    this.overlay.destroy();
    this.map.remove();
  }
}
