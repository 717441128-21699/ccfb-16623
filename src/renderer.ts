import { MAIN_SHADER, LINE_SHADER } from './shaders';
import { buildViolin, fillFiberLines, FIBER_VERTEX_FLOATS, STRIDE } from './violinGeometry';
import { Mat4, cameraPosition, lightDirection, clamp, type OrbitCamera } from './math';
import { store, type ParamState } from './state';

export interface RenderStats {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  adapter: string;
}

export interface BenchmarkResult {
  averageFps: number;
  onePercentLowFps: number;
  medianFrameMs: number;
  width: number;
  height: number;
  frames: number;
}

const UNIFORM_FLOATS = 84;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

export class ViolinRenderer {
  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private format: GPUTextureFormat,
    private canvas: HTMLCanvasElement,
  ) {}

  static async create(canvas: HTMLCanvasElement): Promise<ViolinRenderer> {
    if (!navigator.gpu) {
      throw new Error('当前浏览器没有暴露 navigator.gpu，请使用最新版 Chrome/Edge 并开启 WebGPU。');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('没有找到可用的 WebGPU 适配器。');
    const device = await adapter.requestDevice();
    device.addEventListener?.('uncapturederror', (event) => {
      console.error('WebGPU uncaptured error:', event);
    });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法取得 WebGPU canvas context。');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const renderer = new ViolinRenderer(device, context, format, canvas);
    renderer.adapterDescription = (adapter as unknown as { info?: GPUAdapterInfo }).info?.description ?? 'WebGPU high-performance adapter';
    await renderer.init();
    return renderer;
  }

  private adapterDescription = 'WebGPU adapter';
  private uniformData = new Float32Array(UNIFORM_FLOATS);
  private uniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;
  private layout!: GPUBindGroupLayout;
  private mainPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private vertexBuffer!: GPUBuffer;
  private indexBuffer!: GPUBuffer;
  private lineBuffer!: GPUBuffer;
  private indexCount = 0;
  private lineVertexCount = FIBER_VERTEX_FLOATS / 7;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private fiberSignature = '';

  camera: OrbitCamera = { yaw: 0, pitch: 0.07, distance: 5.95, target: [0, 0.72, 0] };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private sweepDirection = 1;
  stats: RenderStats = { fps: 0, frameMs: 0, width: 1, height: 1, adapter: this.adapterDescription };
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastFrameAt = performance.now();
  private rafId = 0;
  private destroyed = false;
  force4K = false;
  private benchmarkSamples: number[] | null = null;

  private async init(): Promise<void> {
    const mesh = buildViolin();
    this.indexCount = mesh.indices.length;

    this.vertexBuffer = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, mesh.vertices as unknown as BufferSource);

    this.indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices as unknown as BufferSource);

    this.lineBuffer = this.device.createBuffer({
      size: FIBER_VERTEX_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const lineData = new Float32Array(FIBER_VERTEX_FLOATS);
    fillFiberLines(lineData, store.state);
    this.device.queue.writeBuffer(this.lineBuffer, 0, lineData);

    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.layout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: UNIFORM_BYTES },
        },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    const mainModule = this.device.createShaderModule({ code: MAIN_SHADER });
    const mainInfo = await mainModule.getCompilationInfo();
    const mainErrors = mainInfo.messages.filter((m) => m.type === 'error');
    if (mainErrors.length) throw new Error(mainErrors.map((m) => m.message).join('\n'));

    const lineModule = this.device.createShaderModule({ code: LINE_SHADER });
    const lineInfo = await lineModule.getCompilationInfo();
    const lineErrors = lineInfo.messages.filter((m) => m.type === 'error');
    if (lineErrors.length) throw new Error(lineErrors.map((m) => m.message).join('\n'));

    this.device.pushErrorScope('validation');
    this.mainPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: mainModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: STRIDE * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: mainModule,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    const pipelineError = await this.device.popErrorScope();
    if (pipelineError) throw pipelineError;

    this.device.pushErrorScope('validation');
    this.linePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: lineModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 28,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'line-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    const lineError = await this.device.popErrorScope();
    if (lineError) throw lineError;

    this.attachControls();
    this.resize(true);
  }

  private attachControls(): void {
    this.canvas.style.touchAction = 'none';

    const pinchDistanceOf = (): number => {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) this.pinchDistance = pinchDistanceOf();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const previous = this.pointers.get(e.pointerId);
      if (!previous) return;
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        this.camera.yaw -= dx * 0.006;
        this.camera.pitch = clamp(this.camera.pitch + dy * 0.005, -1.15, 1.15);
      } else if (this.pointers.size === 2) {
        const nextDistance = pinchDistanceOf();
        if (this.pinchDistance > 0 && nextDistance > 0) {
          this.camera.distance = clamp(
            this.camera.distance * (this.pinchDistance / nextDistance),
            2.35,
            10.5,
          );
        }
        this.pinchDistance = nextDistance;
      }
    });

    const endPointer = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchDistance = this.pointers.size === 2 ? pinchDistanceOf() : 0;
    };
    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.distance = clamp(this.camera.distance * Math.exp(e.deltaY * 0.001), 2.35, 10.5);
      },
      { passive: false },
    );
  }

  resetCamera(closeBack = false): void {
    if (closeBack) {
      this.camera = { yaw: 0, pitch: 0.03, distance: 2.75, target: [0, -0.08, 0.08] };
    } else {
      this.camera = { yaw: 0, pitch: 0.07, distance: 5.95, target: [0, 0.72, 0] };
    }
  }

  private drawingSize(): { width: number; height: number } {
    if (this.force4K) return { width: 3840, height: 2160 };
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = clamp(store.state.renderScale, 0.5, 2);
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * dpr * scale));
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * dpr * scale));
    return { width, height };
  }

  resize(force = false): void {
    const { width, height } = this.drawingSize();
    if (!force && this.canvas.width === width && this.canvas.height === height && this.depthTexture) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
    this.stats.width = width;
    this.stats.height = height;
  }

  private updateFiberBuffer(s: ParamState): void {
    const signature = `${s.woodPeriodMm}:${s.woodTiltDeg}:${s.woodWarp}`;
    if (signature === this.fiberSignature) return;
    this.fiberSignature = signature;
    const data = new Float32Array(FIBER_VERTEX_FLOATS);
    fillFiberLines(data, s);
    this.device.queue.writeBuffer(this.lineBuffer, 0, data);
  }

  private writeUniforms(s: ParamState, dt: number): void {
    const data = this.uniformData;
    data.fill(0);
    const eye = cameraPosition(this.camera);
    const proj = Mat4.perspective(42, this.canvas.width / this.canvas.height, 0.05, 60);
    const view = Mat4.lookAt(eye, this.camera.target, [0, 1, 0]);
    const vp = Mat4.multiply(proj, view);
    data.set(vp, 0);

    data.set([eye[0], eye[1], eye[2], 1], 16);
    const writeLight = (index: number, azimuth: number, elevation: number, color: [number, number, number], intensity: number) => {
      const d = lightDirection(azimuth, elevation);
      data.set([d[0], d[1], d[2], 0], index);
      data.set([color[0], color[1], color[2], intensity], index + 4);
    };
    writeLight(20, s.key.azimuth, s.key.elevation, s.key.color, s.key.intensity);
    writeLight(28, s.fill.azimuth, s.fill.elevation, s.fill.color, s.fill.intensity);
    writeLight(36, s.rim.azimuth, s.rim.elevation, s.rim.color, s.rim.intensity);

    this.fpsTime += dt;
    data.set([s.ambient, s.exposure, performance.now() / 1000, 0], 44);
    data.set([s.woodPeriodMm / 176, (s.woodTiltDeg * Math.PI) / 180, s.woodSharpness, s.woodContrast], 48);
    data.set([...s.woodDeep, 1], 52);
    data.set([...s.woodLight, 1], 56);
    data.set([...s.woodSheen, 1], 60);
    data.set([...s.absorption, s.absorptionStrength], 64);
    data.set([...s.scatter, s.scatterStrength], 68);
    data.set([s.layers, s.thicknessMm, s.coatRoughness, s.wear], 72);
    data.set([...s.primer, 1], 76);
    data.set([s.thicknessHeatmap ? 1 : 0, s.woodWarp, s.showFibers ? 1 : 0, 0], 80);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(dt: number): void {
    if (this.destroyed) return;
    const s = store.state;
    if (s.autoRotate && this.pointers.size === 0) this.camera.yaw += dt * 0.18;
    if (s.autoSweep) {
      let next = s.lightAngle + dt * 18 * s.sweepSpeed * this.sweepDirection;
      if (next > 72) {
        next = 72;
        this.sweepDirection = -1;
      } else if (next < -72) {
        next = -72;
        this.sweepDirection = 1;
      }
      const angle = next;
      store.set({ lightAngle: angle, key: { ...s.key, azimuth: 0, elevation: angle } });
    }
    this.resize();
    this.updateFiberBuffer(s);
    this.writeUniforms(s, dt);

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.018, g: 0.014, b: 0.011, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.setPipeline(this.mainPipeline);
    pass.drawIndexed(this.indexCount);
    if (s.showFibers) {
      pass.setPipeline(this.linePipeline);
      pass.setVertexBuffer(0, this.lineBuffer);
      pass.draw(this.lineVertexCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
      this.lastFrameAt = now;
      const frameStart = performance.now();
      this.render(dt);
      const frameMs = performance.now() - frameStart;

      this.fpsFrames++;
      if (this.fpsTime >= 0.5) {
        this.stats.fps = Math.round(this.fpsFrames / this.fpsTime);
        this.stats.frameMs = Math.round((frameMs + Number.EPSILON) * 10) / 10;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
      if (this.benchmarkSamples) this.benchmarkSamples.push(dt * 1000);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  async benchmark4K(durationMs = 5200): Promise<BenchmarkResult> {
    const previousScale = store.state.renderScale;
    const previousAdaptive = store.state.adaptiveResolution;
    store.set({ adaptiveResolution: false });
    this.force4K = true;
    this.resize(true);
    this.benchmarkSamples = [];
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (performance.now() - started >= durationMs) resolve();
        else setTimeout(tick, 100);
      };
      tick();
    });
    const samples = this.benchmarkSamples.slice();
    this.benchmarkSamples = null;
    this.force4K = false;
    store.set({ renderScale: previousScale, adaptiveResolution: previousAdaptive });
    this.resize(true);

    samples.sort((a, b) => a - b);
    const avg = samples.length ? 1000 / (samples.reduce((x, y) => x + y, 0) / samples.length) : 0;
    const p1Index = Math.floor(samples.length * 0.99);
    const onePercentLow = samples.length ? 1000 / samples[Math.min(samples.length - 1, p1Index)] : 0;
    const median = samples.length ? samples[Math.floor(samples.length * 0.5)] : 0;
    return {
      averageFps: Math.round(avg),
      onePercentLowFps: Math.round(onePercentLow),
      medianFrameMs: Math.round(median * 100) / 100,
      width: 3840,
      height: 2160,
      frames: samples.length,
    };
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.depthTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.lineBuffer?.destroy();
  }
}
