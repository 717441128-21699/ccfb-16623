export type PageId = 'display' | 'wood' | 'varnish' | 'lighting';

export type RGB = [number, number, number];

export interface LightParams {
  azimuth: number;
  elevation: number;
  intensity: number;
  color: RGB;
}

export interface ParamState {
  page: PageId;
  instrument: string;

  // Maple orientation / chatoyancy
  woodPreset: string;
  woodPeriodMm: number;
  woodTiltDeg: number;
  woodSharpness: number;
  woodContrast: number;
  woodWarp: number;
  woodDeep: RGB;
  woodLight: RGB;
  woodSheen: RGB;
  showFibers: boolean;

  // Varnish
  varnishPreset: string;
  layers: number;
  thicknessMm: number;
  absorption: RGB;
  absorptionStrength: number;
  scatter: RGB;
  scatterStrength: number;
  coatRoughness: number;
  wear: number;
  primer: RGB;
  thicknessHeatmap: boolean;

  // Lighting / camera
  key: LightParams;
  fill: LightParams;
  rim: LightParams;
  ambient: number;
  exposure: number;
  autoRotate: boolean;
  autoSweep: boolean;
  sweepSpeed: number;
  lightAngle: number;

  // Performance
  renderScale: number;
  adaptiveResolution: boolean;
}

export interface WoodPreset {
  id: string;
  label: string;
  origin: string;
  periodMm: number;
  tiltDeg: number;
  sharpness: number;
  contrast: number;
  warp: number;
  deep: RGB;
  light: RGB;
  sheen: RGB;
  note: string;
}

export interface VarnishPreset {
  id: string;
  label: string;
  layers: number;
  thicknessMm: number;
  absorption: RGB;
  absorptionStrength: number;
  scatter: RGB;
  scatterStrength: number;
  coatRoughness: number;
  wear: number;
  primer: RGB;
  note: string;
}

export const MM_PER_WORLD_UNIT = 176;

export const WOOD_PRESETS: WoodPreset[] = [
  {
    id: 'bosnian-flame',
    label: '波斯尼亚强虎纹枫',
    origin: '巴尔干山地 · 径向剖板',
    periodMm: 18,
    tiltDeg: 22,
    sharpness: 24,
    contrast: 1.25,
    warp: 0.22,
    deep: [0.34, 0.16, 0.055],
    light: [0.96, 0.66, 0.25],
    sheen: [1.0, 0.78, 0.38],
    note: '波浪周期较长，纤维倾角大，扫光时条纹位移和极性反转都很明显。',
  },
  {
    id: 'european-gold',
    label: '欧洲金色虎纹枫',
    origin: '喀尔巴阡 ·  quarter-sawn',
    periodMm: 13,
    tiltDeg: 16,
    sharpness: 26,
    contrast: 1.02,
    warp: 0.3,
    deep: [0.29, 0.12, 0.035],
    light: [0.86, 0.55, 0.2],
    sheen: [1.0, 0.76, 0.38],
    note: '中等周期与较锐的各向异性反射，适合经典金琥珀漆。',
  },
  {
    id: 'sichuan-fine',
    label: '川蜀密纹枫',
    origin: '中国西南 · 高海拔枫木',
    periodMm: 8.5,
    tiltDeg: 13,
    sharpness: 34,
    contrast: 1.05,
    warp: 0.28,
    deep: [0.38, 0.19, 0.065],
    light: [0.91, 0.61, 0.27],
    sheen: [1.0, 0.75, 0.36],
    note: '短周期形成细密虎纹；条纹物理宽度随周期等比例变窄。',
  },
  {
    id: 'broad-curl',
    label: '宽波影枫',
    origin: '北美硬枫 · 宽波浪纹',
    periodMm: 29,
    tiltDeg: 11,
    sharpness: 20,
    contrast: 0.95,
    warp: 0.12,
    deep: [0.46, 0.25, 0.09],
    light: [0.95, 0.72, 0.39],
    sheen: [1.0, 0.84, 0.55],
    note: '波浪平缓、条带宽阔，反转角较小但移动幅度大。',
  },
];

export const VARNISH_PRESETS: VarnishPreset[] = [
  {
    id: 'cremona-gold',
    label: '克雷莫纳金琥珀',
    layers: 5,
    thicknessMm: 0.22,
    absorption: [0.42, 1.05, 2.15],
    absorptionStrength: 1.0,
    scatter: [1.0, 0.47, 0.16],
    scatterStrength: 0.16,
    coatRoughness: 0.16,
    wear: 0.18,
    primer: [0.92, 0.78, 0.52],
    note: '五层油基清漆，蓝绿通道吸收强于红通道，厚处自然转深转暖。',
  },
  {
    id: 'venetian-red',
    label: '威尼斯红棕漆',
    layers: 6,
    thicknessMm: 0.27,
    absorption: [0.72, 1.35, 2.0],
    absorptionStrength: 1.12,
    scatter: [0.82, 0.25, 0.10],
    scatterStrength: 0.13,
    coatRoughness: 0.19,
    wear: 0.12,
    primer: [0.86, 0.67, 0.40],
    note: '红棕色素更多，厚区接近深酒红，镜面高光仍保持清亮。',
  },
  {
    id: 'modern-clear',
    label: '现代透明亮光漆',
    layers: 3,
    thicknessMm: 0.13,
    absorption: [0.18, 0.42, 0.72],
    absorptionStrength: 0.75,
    scatter: [1.0, 0.72, 0.42],
    scatterStrength: 0.07,
    coatRoughness: 0.08,
    wear: 0.04,
    primer: [0.94, 0.84, 0.62],
    note: '少层、低吸收、低粗糙度，突出锐利灯箱反射。',
  },
  {
    id: 'worn-master',
    label: '十八世纪老琴磨损',
    layers: 5,
    thicknessMm: 0.24,
    absorption: [0.50, 1.12, 2.0],
    absorptionStrength: 1.05,
    scatter: [1.0, 0.48, 0.18],
    scatterStrength: 0.18,
    coatRoughness: 0.23,
    wear: 0.78,
    primer: [0.96, 0.86, 0.64],
    note: '边缘、接触点和高拱处漆层被磨薄，露出浅色矿物底漆。',
  },
];

export const INSTRUMENT_PRESETS = [
  { id: 'solo-gold', label: '独奏家 · 金枫', wood: 'european-gold', varnish: 'cremona-gold' },
  { id: 'old-master', label: '老琴 · 磨损金漆', wood: 'bosnian-flame', varnish: 'worn-master' },
  { id: 'fine-flame', label: '录音室 · 密纹', wood: 'sichuan-fine', varnish: 'modern-clear' },
  { id: 'broad-stage', label: '舞台 · 宽纹', wood: 'broad-curl', varnish: 'venetian-red' },
];

const wood = WOOD_PRESETS[1];
const varnish = VARNISH_PRESETS[0];

export const defaultState: ParamState = {
  page: 'display',
  instrument: 'solo-gold',

  woodPreset: wood.id,
  woodPeriodMm: wood.periodMm,
  woodTiltDeg: wood.tiltDeg,
  woodSharpness: wood.sharpness,
  woodContrast: wood.contrast,
  woodWarp: wood.warp,
  woodDeep: [...wood.deep],
  woodLight: [...wood.light],
  woodSheen: [...wood.sheen],
  showFibers: false,

  varnishPreset: varnish.id,
  layers: varnish.layers,
  thicknessMm: varnish.thicknessMm,
  absorption: [...varnish.absorption],
  absorptionStrength: varnish.absorptionStrength,
  scatter: [...varnish.scatter],
  scatterStrength: varnish.scatterStrength,
  coatRoughness: varnish.coatRoughness,
  wear: varnish.wear,
  primer: [...varnish.primer],
  thicknessHeatmap: false,

  key: { azimuth: 0, elevation: 24, intensity: 2.45, color: [1.0, 0.86, 0.66] },
  fill: { azimuth: -52, elevation: 18, intensity: 0.78, color: [0.58, 0.72, 1.0] },
  rim: { azimuth: 132, elevation: 38, intensity: 1.45, color: [1.0, 0.72, 0.42] },
  ambient: 0.16,
  exposure: 0.98,
  autoRotate: false,
  autoSweep: false,
  sweepSpeed: 0.55,
  lightAngle: 24,

  renderScale: 1,
  adaptiveResolution: true,
};

type Listener = (state: ParamState, patch?: Partial<ParamState>) => void;

class Store {
  state: ParamState = structuredClone(defaultState);
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<ParamState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state, patch));
  }

  setLight(which: 'key' | 'fill' | 'rim', patch: Partial<LightParams>): void {
    this.state = {
      ...this.state,
      [which]: { ...this.state[which], ...patch },
    };
    this.listeners.forEach((fn) => fn(this.state));
  }

  reset(): void {
    this.state = structuredClone(defaultState);
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export const store = new Store();

export function applyWoodPreset(id: string): void {
  const p = WOOD_PRESETS.find((x) => x.id === id) ?? WOOD_PRESETS[0];
  store.set({
    woodPreset: p.id,
    woodPeriodMm: p.periodMm,
    woodTiltDeg: p.tiltDeg,
    woodSharpness: p.sharpness,
    woodContrast: p.contrast,
    woodWarp: p.warp,
    woodDeep: [...p.deep],
    woodLight: [...p.light],
    woodSheen: [...p.sheen],
  });
}

export function applyVarnishPreset(id: string): void {
  const p = VARNISH_PRESETS.find((x) => x.id === id) ?? VARNISH_PRESETS[0];
  store.set({
    varnishPreset: p.id,
    layers: p.layers,
    thicknessMm: p.thicknessMm,
    absorption: [...p.absorption],
    absorptionStrength: p.absorptionStrength,
    scatter: [...p.scatter],
    scatterStrength: p.scatterStrength,
    coatRoughness: p.coatRoughness,
    wear: p.wear,
    primer: [...p.primer],
  });
}

export function applyInstrumentPreset(id: string): void {
  const inst = INSTRUMENT_PRESETS.find((x) => x.id === id) ?? INSTRUMENT_PRESETS[0];
  const wood = WOOD_PRESETS.find((x) => x.id === inst.wood)!;
  const varnish = VARNISH_PRESETS.find((x) => x.id === inst.varnish)!;
  store.set({
    instrument: id,
    woodPreset: wood.id,
    woodPeriodMm: wood.periodMm,
    woodTiltDeg: wood.tiltDeg,
    woodSharpness: wood.sharpness,
    woodContrast: wood.contrast,
    woodWarp: wood.warp,
    woodDeep: [...wood.deep],
    woodLight: [...wood.light],
    woodSheen: [...wood.sheen],
    varnishPreset: varnish.id,
    layers: varnish.layers,
    thicknessMm: varnish.thicknessMm,
    absorption: [...varnish.absorption],
    absorptionStrength: varnish.absorptionStrength,
    scatter: [...varnish.scatter],
    scatterStrength: varnish.scatterStrength,
    coatRoughness: varnish.coatRoughness,
    wear: varnish.wear,
    primer: [...varnish.primer],
  });
}
