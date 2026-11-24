# 枫纹 · WebGPU 提琴工坊

一个无外部模型/贴图资源的交互式提琴展示应用。琴体、纤维方向线和灯光均由程序化几何与 WebGPU/WGSL 着色器生成，TypeScript 负责界面、状态、相机和公式校验。

## 运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址（默认 <http://localhost:5173>）。需要支持 WebGPU 的新版 Chrome / Edge。

生产构建：

```bash
npm run build
npm run preview
```

应用包含四个可收藏的哈希页面：

- `#/display` 琴体展示
- `#/wood` 木纹结构
- `#/varnish` 漆层讲解
- `#/lighting` 灯光布置

## 需求对应实现

### 1. 纤维倾角驱动虎纹移动与反转

坐标约定：`y` 沿提琴纵向，`N` 是弧面法线，`T` 是 `+Y` 投影到曲面后的纵向切线。波浪纤维倾角为

\[
\theta(y)=\theta_{\max}\sin\left(\frac{2\pi y}{\lambda}+\phi_{\text{warp}}(x,y)\right)
\]

局部纤维向量和微法线为

\[
F=T\cos\theta+N\sin\theta,\qquad
M=N\cos\theta-T\sin\theta
\]

视线接近法线时，半程向量在 `T/N` 平面中的角 `h` 与灯光入射角 `L` 满足 `h ≈ L/2`。着色器使用 Kajiya-Kay 风格的各向异性反射：

\[
I_{\text{fiber}}=\left(1-(F\cdot H)^2\right)^k
=\cos^{2k}(h+\theta)
\]

亮带解析解为 `θ(φ)=-h`，即

\[
\sin\phi=-\frac{h}{\theta_{\max}}
\]

因此：

- 灯光角度变化时，亮带相位按上式移动；
- 小角度位移为 `Δy ≈ -λ h / (2π θmax)`；
- 当 `|h| ≥ θmax`，两个亮带解合并到原负极值暗带 `φ=3π/2`；
- 法线视角下对应灯光角约为 `L_swap ≈ 2θmax`，原亮带变暗、原暗带变亮。

`src/woodMath.ts` 与 WGSL 使用同一套相位和反射公式；木纹页右侧 SVG 曲线、相位/毫米读数和自检徽标由 TypeScript 实时计算。页面中的“转到理论极性反转角”会直接把主光送到该角度。

### 2. 周期、条宽与 4K 性能

- `woodPeriodMm` 直接进入 WGSL 空间频率 `2πy / λ_world`，所以虎纹间距和同相位角宽对应的物理条宽都随周期变化。
- 内置四种自编木料：波斯尼亚强虎纹枫、欧洲金色虎纹枫、川蜀密纹枫、宽波影枫。
- 内置四种自编漆：克雷莫纳金琥珀、威尼斯红棕、现代透明亮光、十八世纪老琴磨损。
- 几何约一万余顶点，背板/面板/侧板/琴颈/琴弦均为程序化生成。
- 不使用后期处理、阴影贴图或屏幕空间多 Pass；主要成本只有一次三角面绘制和可选线框向量。
- 4K 压测按钮会把绘图缓冲固定为 `3840×2160` 采样 5.2 秒并报告平均 FPS、1% Low 和中位帧时。开发机的 headless Chrome/Windows WebGPU 验证中平均约 `134 FPS`、中位帧时约 `6.9 ms`；实际结果取决于 GPU 和浏览器 WebGPU 后端。
- 默认 DPR 上限 1.5，提供渲染倍率和掉帧动态分辨率选项。

## 多层漆模型

漆层不是单纯透明颜色。WGSL 对最多六层执行：

1. 每层独立厚度抖动；
2. Beer-Lambert 往返吸收：

\[
T_{\text{round}}=
\exp\left[-\sigma_\lambda d
\left(\frac1{\cos\theta_l}+\frac1{\cos\theta_v}\right)\right]
\]

3. 红/绿/蓝使用不同吸收系数，蓝绿吸收更强，所以厚处更深、更暖；
4. 层内琥珀散射；
5. 二次、三次内部往返反弹；
6. GGX 清亮镜面反射、Schlick Fresnel 和程序化摄影棚灯箱反射。

老琴磨损由边缘、端边、接触区和程序噪声共同生成磨蚀遮罩；磨损处漆厚降至约 7.5%，并混入浅色矿物底漆。漆层页可开启 WebGPU 漆厚热力图。

## 主要目录

```text
index.html                 四页布局与控件
src/main.ts                启动 WebGPU 渲染器
src/state.ts               参数、木料/漆预设、全局 store
src/math.ts                mat4、相机和灯光方向
src/violinGeometry.ts      程序化提琴与纤维向量线
src/shaders.ts             主 WGSL 表面/漆/纤维着色器和线框着色器
src/renderer.ts            WebGPU 设备、管线、uniform、渲染循环、4K 压测
src/woodMath.ts            与着色器对应的公式、亮带预测和自检
src/ui.ts                  控件、哈希路由、SVG 曲线、漆层示意图
scripts/verify-browser.mjs 可选的 Puppeteer/Chrome 运行时验证
```

## 浏览器验证

如果本机安装了 Puppeteer 兼容的 Chrome，可在预览服务器运行后执行：

```bash
node scripts/verify-browser.mjs http://127.0.0.1:4173/
node scripts/run-benchmark.mjs http://127.0.0.1:4173/
```

验证脚本会检查 WebGPU 初始化、WGSL 编译、四个页面、角度控件和公式自检，并把各页面截图写入 `screenshots/`。
