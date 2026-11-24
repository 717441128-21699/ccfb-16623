import './style.css';
import { ViolinRenderer } from './renderer';
import { initUI, startStatsLoop } from './ui';

const canvas = document.getElementById('gpu') as HTMLCanvasElement | null;
let renderer: ViolinRenderer | null = null;

initUI(() => renderer);

function showFallback(message: string): void {
  const fallback = document.getElementById('fallback');
  const messageEl = document.getElementById('fallback-message');
  if (fallback) fallback.hidden = false;
  if (messageEl) messageEl.textContent = message;
}

if (!canvas) {
  showFallback('页面缺少 #gpu canvas。');
} else {
  ViolinRenderer.create(canvas)
    .then((created) => {
      renderer = created;
      created.start();
      startStatsLoop(created);
    })
    .catch((error: unknown) => {
      console.error(error);
      showFallback(error instanceof Error ? error.message : String(error));
    });
}
