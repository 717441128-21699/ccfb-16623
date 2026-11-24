import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:47831/';
mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  args: [
    '--no-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features',
    '--use-angle=d3d11',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage();
const messages = [];
page.on('console', (msg) => messages.push(`[console.${msg.type()}] ${msg.text()}`));
page.on('pageerror', (error) => messages.push(`[pageerror] ${error.stack || error.message}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
await new Promise((resolve) => setTimeout(resolve, 4500));

const status = await page.evaluate(() => {
  const canvas = document.querySelector('#gpu');
  const fallback = document.querySelector('#fallback');
  return {
    navigatorGpu: Boolean(navigator.gpu),
    fallbackHidden: fallback ? fallback.hidden : null,
    fallbackText: document.querySelector('#fallback-message')?.textContent ?? '',
    fps: document.querySelector('#fpsText')?.textContent ?? '',
    resolution: document.querySelector('#resolutionText')?.textContent ?? '',
    canvas: canvas ? [canvas.width, canvas.height] : null,
    selfCheck: document.querySelector('#selfCheck')?.textContent ?? '',
  };
});

await page.screenshot({ path: 'screenshots/verify-display.png' });

for (const [pageId, file] of [
  ['wood', 'verify-wood.png'],
  ['varnish', 'verify-varnish.png'],
  ['lighting', 'verify-lighting.png'],
]) {
  await page.evaluate((id) => {
    document.querySelector(`.tab[data-page="${id}"]`)?.click();
  }, pageId);
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.screenshot({ path: `screenshots/${file}` });
}

// Capture the same close-up at several light angles to inspect stripe motion.
await page.evaluate(() => document.querySelector('#backCameraBtn')?.click());
await new Promise((resolve) => setTimeout(resolve, 700));
for (const angle of [-28, 0, 18, 36, 62]) {
  await page.evaluate((value) => {
    const input = document.querySelector('#woodLightAngle');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, angle);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await page.screenshot({ path: `screenshots/angle-${angle}.png` });
}

// Exercise the angle control that should move the predicted stripes.
await page.evaluate(() => document.querySelector('.tab[data-page="wood"]')?.click());
await new Promise((resolve) => setTimeout(resolve, 300));
const angleCheck = await page.evaluate(() => {
  const input = document.querySelector('#woodLightAngle');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '62');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return document.querySelector('#stripeReadout')?.textContent ?? '';
});

await page.evaluate(() => {
  document.querySelector('#showFibers')?.click();
  const period = document.querySelector('#woodPeriodMm');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(period, '24');
  period.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((resolve) => setTimeout(resolve, 500));
await page.evaluate(() => document.querySelector('.tab[data-page="varnish"]')?.click());
await new Promise((resolve) => setTimeout(resolve, 300));
await page.evaluate(() => document.querySelector('#thicknessHeatmap')?.click());
await new Promise((resolve) => setTimeout(resolve, 900));
await page.screenshot({ path: 'screenshots/feature-heatmap.png' });
const featureStatus = await page.evaluate(() => ({
  fibers: document.querySelector('#showFibers')?.checked,
  heatmap: document.querySelector('#thicknessHeatmap')?.checked,
  resolution: document.querySelector('#resolutionText')?.textContent,
}));

console.log(JSON.stringify({ status, angleCheck, featureStatus }, null, 2));
console.log('--- browser messages ---');
console.log(messages.length ? messages.join('\n') : '(no console messages)');
await browser.close();

const failed =
  status.fallbackHidden === false ||
  messages.some((line) => line.includes('[pageerror]') || line.includes('WGSL') || line.includes('WebGPU error'));
process.exit(failed ? 1 : 0);
