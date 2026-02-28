import type { Aircraft, AircraftFilter, AircraftCategory } from '../types/aircraft.ts';

export interface HudState {
  selectedAircraft: Aircraft | null;
  aircraftCount: number;
  filteredCount: number;
  fps: number;
  gpuMs: number;
  jsMs: number;
  isSimulating: boolean;
  viewMode: '3d' | '2d';
  filter: AircraftFilter;
}

export class HudUI {
  private container: HTMLElement;
  private statsEl: HTMLElement;
  private trackPanel: HTMLElement;
  private filterPanel: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private simBadge: HTMLElement;
  private onModeToggle: (() => void) | null = null;
  private onFilterChange: ((filter: AircraftFilter) => void) | null = null;
  private onReset: (() => void) | null = null;
  private currentFilter: AircraftFilter;

  constructor(container: HTMLElement, initialFilter: AircraftFilter) {
    this.container = container;
    this.currentFilter = initialFilter;
    this.statsEl = document.createElement('div');
    this.trackPanel = document.createElement('div');
    this.filterPanel = document.createElement('div');
    this.modeBtn = document.createElement('button');
    this.simBadge = document.createElement('div');
    this.buildUI();
  }

  private buildUI(): void {
    this.container.innerHTML = '';

    // Stats overlay (top-left)
    this.statsEl.className = 'hud-stats';
    this.container.appendChild(this.statsEl);

    // Simulation badge
    this.simBadge.className = 'hud-sim-badge';
    this.simBadge.textContent = '⚠ SIMULATION MODE';
    this.simBadge.style.display = 'none';
    this.container.appendChild(this.simBadge);

    // Mode toggle button
    this.modeBtn.className = 'hud-mode-btn';
    this.modeBtn.textContent = '🌐 3D Globe';
    this.modeBtn.addEventListener('click', () => this.onModeToggle?.());
    this.container.appendChild(this.modeBtn);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'hud-reset-btn';
    resetBtn.textContent = '⟳ Reset';
    resetBtn.addEventListener('click', () => this.onReset?.());
    this.container.appendChild(resetBtn);

    // Filter panel (top-right)
    this.filterPanel.className = 'hud-filter-panel';
    this.buildFilterPanel();
    this.container.appendChild(this.filterPanel);

    // Track detail panel (bottom-right)
    this.trackPanel.className = 'hud-track-panel';
    this.trackPanel.style.display = 'none';
    this.container.appendChild(this.trackPanel);

    // OSM Attribution (bottom-left, always visible)
    const attribution = document.createElement('div');
    attribution.className = 'hud-attribution';
    attribution.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>';
    this.container.appendChild(attribution);
  }

  private buildFilterPanel(): void {
    this.filterPanel.innerHTML = `
      <div class="filter-title">FILTERS</div>
      <div class="filter-section">
        <label>Altitude (ft)</label>
        <div class="filter-row">
          <input type="number" id="alt-min" value="${this.currentFilter.minAltitudeFt}" min="-1000" max="60000" step="1000">
          <span>—</span>
          <input type="number" id="alt-max" value="${this.currentFilter.maxAltitudeFt}" min="0" max="60000" step="1000">
        </div>
      </div>
      <div class="filter-section">
        <label>Categories</label>
        <div class="filter-cats">
          ${this.buildCategoryCheckboxes()}
        </div>
      </div>
      <div class="filter-section">
        <label>Callsign</label>
        <input type="text" id="callsign-search" placeholder="Search..." value="${this.currentFilter.searchCallsign}">
      </div>
    `;

    // Bind events
    const altMin = this.filterPanel.querySelector<HTMLInputElement>('#alt-min');
    const altMax = this.filterPanel.querySelector<HTMLInputElement>('#alt-max');
    const callsignSearch = this.filterPanel.querySelector<HTMLInputElement>('#callsign-search');

    altMin?.addEventListener('input', () => this.emitFilterChange());
    altMax?.addEventListener('input', () => this.emitFilterChange());
    callsignSearch?.addEventListener('input', () => this.emitFilterChange());

    this.filterPanel.querySelectorAll<HTMLInputElement>('.cat-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => this.emitFilterChange());
    });
  }

  private buildCategoryCheckboxes(): string {
    const cats: { id: AircraftCategory; label: string; color: string }[] = [
      { id: 'civilian', label: 'Civilian', color: '#ff44ff' },
      { id: 'friend', label: 'Friend', color: '#00ffff' },
      { id: 'neutral', label: 'Neutral', color: '#33ff44' },
      { id: 'unknown', label: 'Unknown', color: '#ffee11' },
      { id: 'hostile', label: 'Hostile', color: '#ff3333' },
    ];

    return cats.map((cat) => `
      <label class="cat-label">
        <input type="checkbox" class="cat-checkbox" data-cat="${cat.id}"
          ${this.currentFilter.categories.has(cat.id) ? 'checked' : ''}>
        <span class="cat-dot" style="background:${cat.color}"></span>
        ${cat.label}
      </label>
    `).join('');
  }

  private emitFilterChange(): void {
    const altMin = this.filterPanel.querySelector<HTMLInputElement>('#alt-min');
    const altMax = this.filterPanel.querySelector<HTMLInputElement>('#alt-max');
    const callsignSearch = this.filterPanel.querySelector<HTMLInputElement>('#callsign-search');

    const categories = new Set<AircraftCategory>();
    this.filterPanel.querySelectorAll<HTMLInputElement>('.cat-checkbox').forEach((cb) => {
      if (cb.checked) {
        const cat = cb.dataset['cat'] as AircraftCategory | undefined;
        if (cat) categories.add(cat);
      }
    });

    this.currentFilter = {
      minAltitudeFt: parseInt(altMin?.value ?? '-1000', 10),
      maxAltitudeFt: parseInt(altMax?.value ?? '60000', 10),
      categories,
      searchCallsign: callsignSearch?.value ?? '',
    };

    this.onFilterChange?.(this.currentFilter);
  }

  update(state: HudState): void {
    // Update stats
    this.statsEl.innerHTML = `
      <div class="stat-row"><span class="stat-label">AIRCRAFT</span><span class="stat-value">${state.filteredCount.toLocaleString()} / ${state.aircraftCount.toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label">FPS</span><span class="stat-value ${state.fps < 30 ? 'warn' : ''}">${state.fps.toFixed(0)}</span></div>
      <div class="stat-row"><span class="stat-label">GPU</span><span class="stat-value">${state.gpuMs.toFixed(1)}ms</span></div>
      <div class="stat-row"><span class="stat-label">JS</span><span class="stat-value">${state.jsMs.toFixed(1)}ms</span></div>
      <div class="stat-row"><span class="stat-label">MODE</span><span class="stat-value">${state.viewMode.toUpperCase()}</span></div>
    `;

    // Update simulation badge
    this.simBadge.style.display = state.isSimulating ? 'block' : 'none';

    // Update mode button
    this.modeBtn.textContent = state.viewMode === '3d' ? '🗺 2D Map' : '🌐 3D Globe';

    // Update track panel
    if (state.selectedAircraft) {
      this.showTrackPanel(state.selectedAircraft);
    } else {
      this.trackPanel.style.display = 'none';
    }
  }

  private showTrackPanel(ac: Aircraft): void {
    this.trackPanel.style.display = 'block';
    const altColor = ac.altitudeFt > 30000 ? '#00ffff' : ac.altitudeFt > 10000 ? '#33ff44' : '#ffee11';
    const vsArrow = ac.verticalRateFpm > 100 ? '▲' : ac.verticalRateFpm < -100 ? '▼' : '→';
    const vsColor = ac.verticalRateFpm > 100 ? '#33ff44' : ac.verticalRateFpm < -100 ? '#ff3333' : '#aaaaaa';

    this.trackPanel.innerHTML = `
      <div class="track-header">
        <span class="track-callsign">${ac.callsign || ac.icao24}</span>
        <span class="track-icao">${ac.icao24.toUpperCase()}</span>
      </div>
      <div class="track-grid">
        <div class="track-item">
          <span class="track-label">ALTITUDE</span>
          <span class="track-value" style="color:${altColor}">${ac.altitudeFt.toLocaleString()} ft</span>
        </div>
        <div class="track-item">
          <span class="track-label">SPEED</span>
          <span class="track-value">${ac.groundSpeedKts.toFixed(0)} kts</span>
        </div>
        <div class="track-item">
          <span class="track-label">HEADING</span>
          <span class="track-value">${ac.trackDeg.toFixed(0)}°</span>
        </div>
        <div class="track-item">
          <span class="track-label">V/S</span>
          <span class="track-value" style="color:${vsColor}">${vsArrow} ${Math.abs(ac.verticalRateFpm).toFixed(0)} fpm</span>
        </div>
        <div class="track-item">
          <span class="track-label">SQUAWK</span>
          <span class="track-value">${ac.squawk}</span>
        </div>
        <div class="track-item">
          <span class="track-label">TYPE</span>
          <span class="track-value">${ac.typeCode || '—'}</span>
        </div>
        <div class="track-item">
          <span class="track-label">REG</span>
          <span class="track-value">${ac.registration || '—'}</span>
        </div>
        <div class="track-item">
          <span class="track-label">CATEGORY</span>
          <span class="track-value">${ac.category.toUpperCase()}</span>
        </div>
        <div class="track-item full-width">
          <span class="track-label">POSITION</span>
          <span class="track-value">${ac.lat.toFixed(4)}° ${ac.lat >= 0 ? 'N' : 'S'} / ${Math.abs(ac.lon).toFixed(4)}° ${ac.lon >= 0 ? 'E' : 'W'}</span>
        </div>
      </div>
      ${ac.isOnGround ? '<div class="track-ground-badge">ON GROUND</div>' : ''}
    `;
  }

  onModeToggleClick(cb: () => void): void {
    this.onModeToggle = cb;
  }

  onFilterUpdate(cb: (filter: AircraftFilter) => void): void {
    this.onFilterChange = cb;
  }

  onResetClick(cb: () => void): void {
    this.onReset = cb;
  }
}
