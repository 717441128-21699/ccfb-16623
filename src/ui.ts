import {
  INSTRUMENT_PRESETS,
  WOOD_PRESETS,
  VARNISH_PRESETS,
  applyInstrumentPreset,
  applyVarnishPreset,
  applyWoodPreset,
  store,
  type LightParams,
  type PageId,
  type ParamState,
  type RGB,
} from './state';
import { predictStripeCenters, stripeSelfCheck, intensityProfile } from './woodMath';
import type { ViolinRenderer, BenchmarkResult } from './renderer';

type RendererGetter = () => ViolinRenderer | null;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll(selector)) as T[];
}

let toastTimer = 0;
export function toast(message: string): void {
  const el = $<HTMLDivElement>('toast');
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function rgbToHex(c: RGB): string {
  return `#${c.map((v) => clamp255(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PAGE_META: Record<PageId, { eyebrow: string; title: string; description: string }> = {
  display: {
    eyebrow: 'INTERACTIVE INSTRUMENT',
    title: '琴体展示',
    description: '拖动旋转琴身，滚轮缩放。主光沿背板纤维平面扫过时，虎纹亮带会按纤维倾角移动并发生极性反转。',
  },
  wood: {
    eyebrow: 'FIBER-ORIENTED REFLECTANCE',
    title: '木纹结构',
    description: '虎纹来自波浪纤维的朝向变化。这里不用静态条纹贴图，而是在 WGSL 中按局部纤维向量 F 计算各向异性反光。',
  },
  varnish: {
    eyebrow: 'MULTI-LAYER BEER-LAMBERT',
    title: '漆层讲解',
    description: '多层有色清漆产生往返吸收与层内散射。厚处蓝绿光被吸收，留下深暖金色；磨损后露出浅色底漆。',
  },
  lighting: {
    eyebrow: 'THREE-POINT LIGHTING',
    title: '灯光布置',
    description: '调整主光、补光和轮廓光的方位、高度、颜色与强度，观察弧形背板上连续变化的纤维高光和镜面清漆反射。',
  },
};

function setOutput(id: string, text: string): void {
  const el = document.getElementById(`${id}Value`);
  if (el) el.textContent = text;
}

function fmt(id: string, value: number): string {
  if (id.endsWith('Mm')) {
    if (id === 'woodPeriodMm') return `${value.toFixed(1)} mm`;
    return `${value.toFixed(2)} mm`;
  }
  if (id === 'woodTiltDeg' || id === 'woodLightAngle' || id === 'displayLightAngle' || id.endsWith('Azimuth') || id.endsWith('Elevation')) {
    return `${value.toFixed(0)}°`;
  }
  if (id === 'woodWarp') return `${value.toFixed(2)} rad`;
  if (id === 'coatRoughness' || id === 'absorptionStrength') return value.toFixed(2);
  if (id === 'scatterStrength' || id === 'ambient' || id === 'displayWear' || id === 'wear') return value.toFixed(2);
  if (id.includes('Intensity')) return value.toFixed(1);
  if (id === 'displayExposure' || id === 'lightingExposure') return value.toFixed(2);
  return String(value);
}

const SCALAR_BINDINGS: Array<[string, keyof ParamState]> = [
  ['woodPeriodMm', 'woodPeriodMm'],
  ['woodTiltDeg', 'woodTiltDeg'],
  ['woodSharpness', 'woodSharpness'],
  ['woodWarp', 'woodWarp'],
  ['woodLightAngle', 'lightAngle'],
  ['displayLightAngle', 'lightAngle'],
  ['displayWear', 'wear'],
  ['wear', 'wear'],
  ['displayExposure', 'exposure'],
  ['lightingExposure', 'exposure'],
  ['layers', 'layers'],
  ['thicknessMm', 'thicknessMm'],
  ['absorptionStrength', 'absorptionStrength'],
  ['scatterStrength', 'scatterStrength'],
  ['coatRoughness', 'coatRoughness'],
  ['ambient', 'ambient'],
];

function syncLightInputs(s: ParamState): void {
  for (const which of ['key', 'fill', 'rim'] as const) {
    const light: LightParams = s[which];
    const cap = which[0].toUpperCase() + which.slice(1);
    const set = (suffix: string, value: string) => {
      const input = document.getElementById(`${which}${suffix}`) as HTMLInputElement | null;
      if (input && document.activeElement !== input) input.value = value;
    };
    set('Azimuth', String(light.azimuth));
    set('Elevation', String(light.elevation));
    set('Intensity', String(light.intensity));
    set('Color', rgbToHex(light.color));
    setOutput(`${which}Azimuth`, `${light.azimuth.toFixed(0)}°`);
    setOutput(`${which}Elevation`, `${light.elevation.toFixed(0)}°`);
    setOutput(`${which}Intensity`, light.intensity.toFixed(1));
  }
}

export function syncAllInputs(s: ParamState = store.state): void {
  for (const [id, key] of SCALAR_BINDINGS) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) continue;
    const value = s[key];
    if (typeof value === 'number') {
      if (document.activeElement !== input) input.value = String(value);
      setOutput(id, fmt(id, value));
    }
  }

  const checks: Array<[string, keyof ParamState]> = [
    ['displayAutoSweep', 'autoSweep'],
    ['woodAutoSweep', 'autoSweep'],
    ['lightingAutoSweep', 'autoSweep'],
    ['displayAutoRotate', 'autoRotate'],
    ['showFibers', 'showFibers'],
    ['thicknessHeatmap', 'thicknessHeatmap'],
    ['adaptiveResolution', 'adaptiveResolution'],
  ];
  for (const [id, key] of checks) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.checked = Boolean(s[key]);
  }

  const selects: Array<[string, string]> = [
    ['instrumentSelect', s.instrument],
    ['displayWoodSelect', s.woodPreset],
    ['varnishSelect', s.varnishPreset],
    ['displayVarnishSelect', s.varnishPreset],
    ['renderScaleSelect', String(s.renderScale)],
  ];
  for (const [id, value] of selects) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select) select.value = value;
  }
  syncLightInputs(s);
  updateStripeChart();
  updateLayerStack();
}

function populateSelects(): void {
  const instrument = $<HTMLSelectElement>('instrumentSelect');
  instrument.innerHTML = INSTRUMENT_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

  const woodOptions = WOOD_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $<HTMLSelectElement>('displayWoodSelect').innerHTML = woodOptions;

  const varnishOptions = VARNISH_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $<HTMLSelectElement>('displayVarnishSelect').innerHTML = varnishOptions;
  $<HTMLSelectElement>('varnishSelect').innerHTML = varnishOptions;
}

function bindScalar(id: string, key: keyof ParamState, after?: () => void): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('input', () => {
    const value = Number.parseFloat(input.value);
    store.set({ [key]: value } as Partial<ParamState>);
    setOutput(id, fmt(id, value));

    // Duplicate controls bound to the same state stay synchronized.
    for (const [dupId, dupKey] of SCALAR_BINDINGS) {
      if (dupKey !== key || dupId === id) continue;
      const dup = document.getElementById(dupId) as HTMLInputElement | null;
      if (dup) dup.value = String(value);
      setOutput(dupId, fmt(dupId, value));
    }
    after?.();
  });
}

function bindCheck(id: string, key: keyof ParamState): void {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    store.set({ [key]: checked } as Partial<ParamState>);
    if (key === 'autoSweep') syncAllInputs(store.state);
  });
}

function bindLights(): void {
  for (const which of ['key', 'fill', 'rim'] as const) {
    const cap = which[0].toUpperCase() + which.slice(1);
    for (const suffix of ['Azimuth', 'Elevation', 'Intensity'] as const) {
      const id = `${which}${suffix}`;
      $<HTMLInputElement>(id).addEventListener('input', (e) => {
        const value = Number.parseFloat((e.target as HTMLInputElement).value);
        const lower = suffix.toLowerCase() as 'azimuth' | 'elevation' | 'intensity';
        store.setLight(which, { [lower]: value });
        setOutput(id, suffix === 'Intensity' ? value.toFixed(1) : `${value.toFixed(0)}°`);
        if (which === 'key' && suffix === 'Elevation') {
          store.set({ lightAngle: value });
          const wood = document.getElementById('woodLightAngle') as HTMLInputElement | null;
          const display = document.getElementById('displayLightAngle') as HTMLInputElement | null;
          if (wood) wood.value = String(value);
          if (display) display.value = String(value);
          setOutput('woodLightAngle', `${value.toFixed(0)}°`);
          setOutput('displayLightAngle', `${value.toFixed(0)}°`);
          updateStripeChart();
        }
        if (which === 'key' && suffix === 'Azimuth' && Math.abs(value) > 1) {
          // The analytic sweep diagram is in the longitudinal plane. Azimuth is available in WebGPU.
        }
      });
    }
    $<HTMLInputElement>(`${which}Color`).addEventListener('input', (e) => {
      store.setLight(which, { color: hexToRgb((e.target as HTMLInputElement).value) });
    });
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function updateStripeChart(): void {
  const svg = document.getElementById('stripeChart') as SVGSVGElement | null;
  if (!svg) return;
  svg.replaceChildren();
  const s = store.state;
  const W = 300;
  const H = 118;
  const padX = 12;
  const padTop = 12;
  const padBottom = 18;
  const span = s.woodPeriodMm * 2.05;
  const profile = intensityProfile(s.lightAngle, s, 280, span);
  const x = (mm: number) => padX + ((mm + span / 2) / span) * (W - padX * 2);
  const y = (v: number) => H - padBottom - Math.max(0, Math.min(1, v)) * (H - padTop - padBottom);

  svg.appendChild(svgEl('line', { x1: padX, x2: W - padX, y1: y(0), y2: y(0), stroke: 'rgba(255,255,255,.14)', 'stroke-width': 1 }));
  for (const frac of [-0.5, 0, 0.5]) {
    const xx = x(frac * s.woodPeriodMm);
    svg.appendChild(svgEl('line', { x1: xx, x2: xx, y1: padTop, y2: H - padBottom, stroke: 'rgba(255,255,255,.055)', 'stroke-width': 1 }));
  }

  let lineD = '';
  let areaD = '';
  profile.forEach((pt, i) => {
    const xx = x(pt.yMm);
    const yy = y(pt.intensity);
    lineD += `${i === 0 ? 'M' : 'L'}${xx.toFixed(2)},${yy.toFixed(2)} `;
    if (i === 0) areaD += `M${xx.toFixed(2)},${y(0).toFixed(2)} L${xx.toFixed(2)},${yy.toFixed(2)} `;
    else areaD += `L${xx.toFixed(2)},${yy.toFixed(2)} `;
  });
  areaD += `L${x(profile[profile.length - 1].yMm).toFixed(2)},${y(0).toFixed(2)} Z`;
  svg.appendChild(svgEl('path', { d: areaD, fill: 'rgba(217,164,65,.18)' }));
  svg.appendChild(svgEl('path', { d: lineD, fill: 'none', stroke: '#ffd37a', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));

  const prediction = predictStripeCenters(s.lightAngle, s);
  for (const rootMm of prediction.rootMm) {
    if (rootMm > -span / 2 && rootMm < span / 2) {
      const xx = x(rootMm);
      svg.appendChild(svgEl('line', { x1: xx, x2: xx, y1: 8, y2: H - 18, stroke: '#71d7e8', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
      svg.appendChild(svgEl('circle', { cx: xx, cy: 13, r: 3.2, fill: '#71d7e8' }));
    }
  }
  const oldX = x(0);
  svg.appendChild(svgEl('line', { x1: oldX, x2: oldX, y1: 8, y2: H - 18, stroke: 'rgba(255,138,107,.75)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));

  const readout = $<HTMLDListElement>('stripeReadout');
  const rows: Array<[string, string]> = [
    ['半程向量角 H', `${prediction.halfAngleDeg.toFixed(1)}°`],
    ['理论反转角 L', `${prediction.swapLightDeg.toFixed(1)}°`],
    ['亮带相位', prediction.rootPhases.map((v) => `${v.toFixed(2)} rad`).join(' / ')],
    ['亮带位置', prediction.rootMm.map((v) => `${v.toFixed(1)} mm`).join(' / ')],
    ['小角位移幅', `${Math.abs(prediction.shiftMm).toFixed(2)} mm/°`],
    ['极性状态', prediction.crossed ? '已越过交换阈值' : '同向移动区间'],
  ];
  readout.innerHTML = rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('');

  const check = stripeSelfCheck(s);
  const checkEl = $<HTMLDivElement>('selfCheck');
  checkEl.classList.toggle('warn', !check.ok);
  checkEl.textContent = check.ok
    ? `✓ 公式自检通过：位移 ${check.displacementMm.toFixed(2)} mm；原亮点 ${check.oldPeakAtSwap.toFixed(2)} → 原暗点 ${check.oldTroughAtSwap.toFixed(2)}。${check.message}`
    : `⚠ ${check.message}`;
}

export function updateLayerStack(): void {
  const stack = document.getElementById('layerStack');
  if (!stack) return;
  const s = store.state;
  let html = '';
  for (let i = 0; i < s.layers; i++) {
    const h = 13 + (s.thicknessMm / s.layers) * 190;
    html += `<div class="layer" style="height:${h.toFixed(1)}px;opacity:${(0.72 + i * 0.04).toFixed(2)}">清漆 L${i + 1}</div>`;
  }
  html += '<div class="layer primer-layer">浅色矿物底漆 / 木胎</div>';
  stack.innerHTML = html;

  const swatch = (d: number): string => {
    const transmission = s.absorption.map((sigma) => Math.exp(-sigma * s.absorptionStrength * d * 2.15));
    const rgb = transmission.map((t, i) => {
      const primer = s.primer[i];
      return clamp255(255 * (primer * 0.34 + t * 0.66));
    });
    return `rgb(${rgb.join(',')})`;
  };
  $<HTMLSpanElement>('thinSwatch').style.background = swatch(0.025);
  $<HTMLSpanElement>('thickSwatch').style.background = swatch(Math.max(0.08, s.thicknessMm));
}

const LIGHT_PRESETS: Record<string, Partial<ParamState>> = {
  studio: {
    key: { azimuth: 0, elevation: 24, intensity: 3.4, color: [1, 0.86, 0.66] },
    fill: { azimuth: -52, elevation: 18, intensity: 1.15, color: [0.58, 0.72, 1] },
    rim: { azimuth: 132, elevation: 38, intensity: 2.2, color: [1, 0.72, 0.42] },
    ambient: 0.22,
  },
  raking: {
    key: { azimuth: 0, elevation: 9, intensity: 4.4, color: [1, 0.82, 0.56] },
    fill: { azimuth: -35, elevation: 30, intensity: 0.42, color: [0.55, 0.68, 1] },
    rim: { azimuth: 155, elevation: 24, intensity: 1.5, color: [1, 0.62, 0.32] },
    ambient: 0.12,
  },
  warm: {
    key: { azimuth: 28, elevation: 34, intensity: 3.1, color: [1, 0.72, 0.42] },
    fill: { azimuth: -70, elevation: 22, intensity: 0.9, color: [1, 0.82, 0.62] },
    rim: { azimuth: 120, elevation: 42, intensity: 2.6, color: [1, 0.55, 0.25] },
    ambient: 0.18,
  },
  archive: {
    key: { azimuth: -28, elevation: 55, intensity: 2.2, color: [1, 0.96, 0.88] },
    fill: { azimuth: 34, elevation: 48, intensity: 1.8, color: [0.82, 0.9, 1] },
    rim: { azimuth: 170, elevation: 60, intensity: 0.8, color: [1, 0.95, 0.86] },
    ambient: 0.42,
  },
};

export function initUI(getRenderer: RendererGetter): void {
  populateSelects();

  const applyPage = (page: PageId): void => {
    store.set({ page });
    $$('.tab').forEach((t) => t.classList.toggle('active', (t as HTMLElement).dataset.page === page));
    $$('.page-panel').forEach((p) => p.classList.toggle('active', (p as HTMLElement).dataset.panel === page));
    const meta = PAGE_META[page];
    $<HTMLParagraphElement>('pageEyebrow').textContent = meta.eyebrow;
    $<HTMLHeadingElement>('pageTitle').textContent = meta.title;
    $<HTMLParagraphElement>('pageDescription').textContent = meta.description;
  };

  const pageFromHash = (): PageId => {
    const hash = window.location.hash.replace(/^#\/?/, '') as PageId;
    return hash in PAGE_META ? hash : 'display';
  };

  $$<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page as PageId;
      window.location.hash = `/${page}`;
    });
  });
  window.addEventListener('hashchange', () => applyPage(pageFromHash()));
  applyPage(pageFromHash());

  $<HTMLSelectElement>('instrumentSelect').addEventListener('change', (e) => {
    applyInstrumentPreset((e.target as HTMLSelectElement).value);
    syncAllInputs();
    toast('已载入提琴、木料与漆层联合预设');
  });
  $<HTMLSelectElement>('displayWoodSelect').addEventListener('change', (e) => {
    applyWoodPreset((e.target as HTMLSelectElement).value);
    syncAllInputs();
    toast('已更新纤维周期与最大倾角');
  });
  const varnishHandler = (e: Event) => {
    applyVarnishPreset((e.target as HTMLSelectElement).value);
    syncAllInputs();
    toast('已载入多层清漆参数');
  };
  $<HTMLSelectElement>('varnishSelect').addEventListener('change', varnishHandler);
  $<HTMLSelectElement>('displayVarnishSelect').addEventListener('change', varnishHandler);

  bindScalar('woodPeriodMm', 'woodPeriodMm', updateStripeChart);
  bindScalar('woodTiltDeg', 'woodTiltDeg', updateStripeChart);
  bindScalar('woodSharpness', 'woodSharpness', updateStripeChart);
  bindScalar('woodWarp', 'woodWarp', updateStripeChart);
  bindScalar('woodLightAngle', 'lightAngle', updateStripeChart);
  bindScalar('displayLightAngle', 'lightAngle', updateStripeChart);
  bindScalar('displayWear', 'wear', updateLayerStack);
  bindScalar('wear', 'wear', updateLayerStack);
  bindScalar('thicknessMm', 'thicknessMm', updateLayerStack);
  bindScalar('layers', 'layers', updateLayerStack);
  bindScalar('absorptionStrength', 'absorptionStrength', updateLayerStack);
  bindScalar('scatterStrength', 'scatterStrength', updateLayerStack);
  bindScalar('coatRoughness', 'coatRoughness');
  bindScalar('ambient', 'ambient');
  bindScalar('displayExposure', 'exposure');
  bindScalar('lightingExposure', 'exposure');

  // Angle controls also drive the key light.
  for (const id of ['woodLightAngle', 'displayLightAngle']) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('input', () => {
      const angle = Number.parseFloat(input.value);
      store.set({ key: { ...store.state.key, azimuth: 0, elevation: angle } });
      const keyEl = document.getElementById('keyElevation') as HTMLInputElement | null;
      if (keyEl) keyEl.value = String(angle);
      setOutput('keyElevation', `${angle.toFixed(0)}°`);
    });
  }

  bindCheck('displayAutoSweep', 'autoSweep');
  bindCheck('woodAutoSweep', 'autoSweep');
  bindCheck('lightingAutoSweep', 'autoSweep');
  bindCheck('displayAutoRotate', 'autoRotate');
  bindCheck('showFibers', 'showFibers');
  bindCheck('thicknessHeatmap', 'thicknessHeatmap');
  bindCheck('adaptiveResolution', 'adaptiveResolution');

  $<HTMLSelectElement>('renderScaleSelect').addEventListener('change', (e) => {
    store.set({ renderScale: Number.parseFloat((e.target as HTMLSelectElement).value) });
  });

  bindLights();

  $<HTMLButtonElement>('resetCameraBtn').addEventListener('click', () => {
    getRenderer()?.resetCamera(false);
    toast('相机已复位到整琴视角');
  });
  $<HTMLButtonElement>('backCameraBtn').addEventListener('click', () => {
    getRenderer()?.resetCamera(true);
    toast('已切换到背板虎纹特写');
  });
  $<HTMLButtonElement>('swapAngleBtn').addEventListener('click', () => {
    const target = Math.min(70, store.state.woodTiltDeg * 2.15);
    store.set({
      lightAngle: target,
      key: { ...store.state.key, azimuth: 0, elevation: target },
    });
    syncAllInputs();
    toast(`主光已转到约 ${target.toFixed(1)}°，观察原亮暗带交换`);
  });

  $$<HTMLButtonElement>('[data-light-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.lightPreset!;
      store.set(LIGHT_PRESETS[id]);
      syncAllInputs();
      toast('灯光预设已应用');
    });
  });

  $<HTMLButtonElement>('benchmarkBtn').addEventListener('click', async () => {
    const renderer = getRenderer();
    const resultEl = $<HTMLParagraphElement>('benchmarkResult');
    if (!renderer) {
      toast('WebGPU 渲染器尚未就绪');
      return;
    }
    const btn = document.getElementById('benchmarkBtn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '4K 压测运行中…';
    resultEl.textContent = '正在以 3840×2160 渲染 5.2 秒，拖动或等待均可…';
    try {
      const result: BenchmarkResult = await renderer.benchmark4K();
      const pass = result.averageFps >= 60;
      resultEl.innerHTML = `平均 <b style="color:${pass ? 'var(--ok)' : 'var(--gold-bright)'}">${result.averageFps} FPS</b> · 1% Low ${result.onePercentLowFps} FPS · 中位帧时 ${result.medianFrameMs} ms · ${result.frames} 帧。${pass ? '达到 4K 60 帧目标。' : '当前 GPU 未稳定到 60；可降低渲染倍率或关闭纤维向量。'}`;
    } catch (err) {
      resultEl.textContent = `压测失败：${(err as Error).message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '运行 3840×2160 五秒压测';
      syncAllInputs();
    }
  });

  syncAllInputs();
}

export function startStatsLoop(renderer: ViolinRenderer): void {
  const fpsText = $<HTMLElement>('fpsText');
  const resolutionText = $<HTMLElement>('resolutionText');
  const pill = $<HTMLElement>('statsPill');
  let adaptTick = 0;
  window.setInterval(() => {
    const stats = renderer.stats;
    fpsText.textContent = `${stats.fps || '--'} FPS`;
    resolutionText.textContent = `${stats.width}×${stats.height} · ${stats.frameMs} ms · WebGPU`;
    pill.classList.toggle('slow', stats.fps > 0 && stats.fps < 50);

    // Keep the angle sliders in sync while the renderer's auto sweep writes state.
    if (store.state.autoSweep) {
      const angle = store.state.lightAngle;
      for (const id of ['woodLightAngle', 'displayLightAngle']) {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input && document.activeElement !== input) input.value = angle.toFixed(1);
        setOutput(id, `${angle.toFixed(0)}°`);
      }
      const keyEl = document.getElementById('keyElevation') as HTMLInputElement | null;
      if (keyEl && document.activeElement !== keyEl) keyEl.value = angle.toFixed(0);
      setOutput('keyElevation', `${angle.toFixed(0)}°`);
      updateStripeChart();
    }

    adaptTick++;
    if (adaptTick >= 5 && store.state.adaptiveResolution && !renderer.force4K && stats.fps > 0 && stats.fps < 54) {
      adaptTick = 0;
      const current = store.state.renderScale;
      const next = current > 0.9 ? 0.75 : current > 0.7 ? 0.65 : current;
      if (next < current) {
        store.set({ renderScale: next });
        const select = document.getElementById('renderScaleSelect') as HTMLSelectElement | null;
        if (select) select.value = String(next);
        toast(`动态分辨率降至 ${next.toFixed(2)}× 以维持流畅`);
      }
    }
  }, 350);
}
