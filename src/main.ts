import { App } from './app.ts';
import { WebGPUNotSupportedError } from './gpu/device.ts';
import './style.css';

async function main(): Promise<void> {
  const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement | null;
  const hudContainer = document.getElementById('hud') as HTMLElement | null;
  const errorOverlay = document.getElementById('error-overlay') as HTMLElement | null;
  const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement | null;

  if (!canvas || !hudContainer) {
    console.error('Required DOM elements not found');
    return;
  }

  try {
    const app = new App();
    await app.init(canvas, hudContainer);

    // Hide loading overlay
    if (loadingOverlay) {
      loadingOverlay.style.opacity = '0';
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 500);
    }

    // Cleanup on unload
    window.addEventListener('beforeunload', () => app.destroy());
  } catch (err) {
    console.error('Failed to initialize app:', err);

    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }

    if (errorOverlay) {
      errorOverlay.style.display = 'flex';
      const msgEl = errorOverlay.querySelector('.error-message');
      if (msgEl) {
        if (err instanceof WebGPUNotSupportedError) {
          msgEl.innerHTML = `
            <h2>WebGPU Not Supported</h2>
            <p>${err.message}</p>
            <p>Please use <strong>Chrome 113+</strong> or <strong>Edge 113+</strong> with WebGPU enabled.</p>
            <p>On Chrome, you can enable it at: <code>chrome://flags/#enable-unsafe-webgpu</code></p>
          `;
        } else {
          msgEl.innerHTML = `
            <h2>Initialization Error</h2>
            <p>${err instanceof Error ? err.message : String(err)}</p>
          `;
        }
      }
    }
  }
}

void main();
