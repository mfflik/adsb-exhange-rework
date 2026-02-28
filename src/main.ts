import { MapApp } from './mapApp.ts';
import './style.css';

async function main(): Promise<void> {
  const loadingEl = document.getElementById('loading');
  const loadingMsg = document.getElementById('loading-msg');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMsg = document.getElementById('error-msg');

  const setMsg = (msg: string): void => {
    if (loadingMsg) loadingMsg.textContent = msg;
  };

  try {
    setMsg('Initializing map...');

    const app = new MapApp();
    await app.init();

    setMsg('Loading aircraft data...');

    // Hide loading overlay
    if (loadingEl) {
      loadingEl.style.opacity = '0';
      setTimeout(() => { loadingEl.style.display = 'none'; }, 400);
    }

    window.addEventListener('beforeunload', () => app.destroy());
  } catch (err) {
    console.error('Failed to initialize:', err);

    if (loadingEl) loadingEl.style.display = 'none';

    if (errorOverlay && errorMsg) {
      errorOverlay.style.display = 'flex';
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('WebGPU')) {
        errorMsg.innerHTML = `
          <p>${msg}</p>
          <p style="margin-top:8px">Please use <strong>Chrome 113+</strong> or <strong>Edge 113+</strong>.</p>
          <p style="margin-top:4px; font-size:11px; color:#6e7681">
            Enable at: <code style="background:#21262d;padding:2px 4px;border-radius:3px">chrome://flags/#enable-unsafe-webgpu</code>
          </p>
        `;
      } else {
        errorMsg.innerHTML = `<p>${msg}</p>`;
      }
    }
  }
}

void main();
