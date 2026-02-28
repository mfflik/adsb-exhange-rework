// UI Controller for the adsb.lol-style interface
import type { Aircraft, AircraftFilter, AircraftCategory } from '../types/aircraft.ts';
import { defaultFilter } from '../types/aircraft.ts';

export interface UiState {
  aircraftCount: number;
  filteredCount: number;
  fps: number;
  isSimulating: boolean;
  selectedAircraft: Aircraft | null;
  nearbyAircraft: readonly Aircraft[];
}

export class UiController {
  private filter: AircraftFilter = defaultFilter();
  private onFilterChange: ((f: AircraftFilter) => void) | null = null;
  private onAircraftSelect: ((icao: string | null) => void) | null = null;
  private onReset: (() => void) | null = null;

  init(): void {
    // Filter panel toggle
    const btnFilter = document.getElementById('btn-filter');
    const filterPanel = document.getElementById('filter-panel');
    const filterClose = document.getElementById('filter-close');

    btnFilter?.addEventListener('click', () => {
      if (filterPanel) {
        filterPanel.style.display = filterPanel.style.display === 'none' ? 'block' : 'none';
      }
    });

    filterClose?.addEventListener('click', () => {
      if (filterPanel) filterPanel.style.display = 'none';
    });

    // Reset button
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      this.onReset?.();
    });

    // Detail panel close
    document.getElementById('detail-close')?.addEventListener('click', () => {
      this.onAircraftSelect?.(null);
      const panel = document.getElementById('detail-panel');
      if (panel) panel.style.display = 'none';
    });

    // Filter inputs
    const altMin = document.getElementById('alt-min') as HTMLInputElement | null;
    const altMax = document.getElementById('alt-max') as HTMLInputElement | null;
    const callsignSearch = document.getElementById('callsign-search') as HTMLInputElement | null;

    altMin?.addEventListener('input', () => this.emitFilter());
    altMax?.addEventListener('input', () => this.emitFilter());
    callsignSearch?.addEventListener('input', () => this.emitFilter());

    document.querySelectorAll<HTMLInputElement>('.cat-cb').forEach((cb) => {
      cb.addEventListener('change', () => this.emitFilter());
    });
  }

  private emitFilter(): void {
    const altMin = (document.getElementById('alt-min') as HTMLInputElement | null)?.value ?? '-1000';
    const altMax = (document.getElementById('alt-max') as HTMLInputElement | null)?.value ?? '60000';
    const callsign = (document.getElementById('callsign-search') as HTMLInputElement | null)?.value ?? '';

    const categories = new Set<AircraftCategory>();
    document.querySelectorAll<HTMLInputElement>('.cat-cb').forEach((cb) => {
      if (cb.checked) {
        const cat = cb.dataset['cat'] as AircraftCategory | undefined;
        if (cat) categories.add(cat);
      }
    });

    this.filter = {
      minAltitudeFt: parseInt(altMin, 10),
      maxAltitudeFt: parseInt(altMax, 10),
      categories,
      searchCallsign: callsign,
    };

    this.onFilterChange?.(this.filter);
  }

  update(state: UiState): void {
    // Stats
    const countEl = document.getElementById('stat-count');
    if (countEl) countEl.textContent = state.filteredCount.toLocaleString();

    const fpsEl = document.getElementById('stat-fps');
    if (fpsEl) {
      fpsEl.textContent = state.fps.toFixed(0);
      fpsEl.style.color = state.fps < 30 ? '#f85149' : '#58a6ff';
    }

    const simBadge = document.getElementById('sim-badge');
    if (simBadge) simBadge.style.display = state.isSimulating ? 'block' : 'none';

    // Detail panel
    if (state.selectedAircraft) {
      this.showDetailPanel(state.selectedAircraft);
    }

    // Aircraft list
    this.updateAircraftList(state.nearbyAircraft, state.selectedAircraft?.icao24 ?? null);
  }

  private showDetailPanel(ac: Aircraft): void {
    const panel = document.getElementById('detail-panel');
    const callsignEl = document.getElementById('detail-callsign');
    const bodyEl = document.getElementById('detail-body');

    if (!panel || !callsignEl || !bodyEl) return;

    panel.style.display = 'block';
    callsignEl.textContent = ac.callsign || ac.icao24.toUpperCase();

    const altColor = ac.altitudeFt > 30000 ? 'hi' : ac.altitudeFt > 10000 ? '' : 'warn';
    const vsClass = ac.verticalRateFpm > 100 ? 'up' : ac.verticalRateFpm < -100 ? 'down' : '';
    const vsArrow = ac.verticalRateFpm > 100 ? '▲' : ac.verticalRateFpm < -100 ? '▼' : '→';

    bodyEl.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Altitude</span>
          <span class="detail-value ${altColor}">${ac.altitudeFt.toLocaleString()} ft</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Speed</span>
          <span class="detail-value">${ac.groundSpeedKts.toFixed(0)} kts</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Heading</span>
          <span class="detail-value">${ac.trackDeg.toFixed(0)}°</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Vert. Rate</span>
          <span class="detail-value ${vsClass}">${vsArrow} ${Math.abs(ac.verticalRateFpm).toFixed(0)} fpm</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Squawk</span>
          <span class="detail-value">${ac.squawk}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Type</span>
          <span class="detail-value">${ac.typeCode || '—'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Reg.</span>
          <span class="detail-value">${ac.registration || '—'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Category</span>
          <span class="detail-value">${ac.category}</span>
        </div>
        <div class="detail-item full">
          <span class="detail-label">ICAO24</span>
          <span class="detail-value">${ac.icao24.toUpperCase()}</span>
        </div>
        <div class="detail-item full">
          <span class="detail-label">Position</span>
          <span class="detail-value">${ac.lat.toFixed(4)}° ${ac.lat >= 0 ? 'N' : 'S'} / ${Math.abs(ac.lon).toFixed(4)}° ${ac.lon >= 0 ? 'E' : 'W'}</span>
        </div>
      </div>
      ${ac.isOnGround ? '<div class="ground-badge">ON GROUND</div>' : ''}
    `;
  }

  private updateAircraftList(aircraft: readonly Aircraft[], selectedIcao: string | null): void {
    const listBody = document.getElementById('list-body');
    const listCount = document.getElementById('list-count');

    if (!listBody) return;

    const display = aircraft.slice(0, 50); // Show top 50
    if (listCount) listCount.textContent = display.length.toString();

    listBody.innerHTML = display.map((ac) => {
      const color = getCategoryColor(ac.category);
      const isSelected = ac.icao24 === selectedIcao;
      const altStr = ac.isOnGround ? 'GND' : `${Math.round(ac.altitudeFt / 100) * 100}ft`;

      return `
        <div class="list-item ${isSelected ? 'selected' : ''}" data-icao="${ac.icao24}">
          <span class="list-dot" style="background:${color}"></span>
          <span class="list-callsign">${ac.callsign || ac.icao24.toUpperCase()}</span>
          <span class="list-alt">${altStr}</span>
        </div>
      `;
    }).join('');

    // Bind click events
    listBody.querySelectorAll<HTMLElement>('.list-item').forEach((el) => {
      el.addEventListener('click', () => {
        const icao = el.dataset['icao'];
        if (icao) this.onAircraftSelect?.(icao);
      });
    });
  }

  onFilterUpdate(cb: (f: AircraftFilter) => void): void {
    this.onFilterChange = cb;
  }

  onSelect(cb: (icao: string | null) => void): void {
    this.onAircraftSelect = cb;
  }

  onResetView(cb: () => void): void {
    this.onReset = cb;
  }

  getFilter(): AircraftFilter {
    return this.filter;
  }
}

function getCategoryColor(category: AircraftCategory): string {
  switch (category) {
    case 'friend': return '#39d0d8';
    case 'hostile': return '#f85149';
    case 'neutral': return '#3fb950';
    case 'unknown': return '#d29922';
    case 'civilian': return '#bc8cff';
    default: return '#8b949e';
  }
}
