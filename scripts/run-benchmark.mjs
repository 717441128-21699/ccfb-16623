import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:47861/';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const messages = [];
page.on('console', (msg) => messages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
await new Promise((r) => setTimeout(r, 2500));
await page.click('#benchmarkBtn');
await new Promise((r) => setTimeout(r, 7500));
const result = await page.evaluate(() => ({
  text: document.querySelector('#benchmarkResult')?.textContent ?? '',
  stats: document.querySelector('#resolutionText')?.textContent ?? '',
  fps: document.querySelector('#fpsText')?.textContent ?? '',
}));
console.log(JSON.stringify(result, null, 2));
const errors = messages.filter((m) => m.includes('[error]') || m.includes('pageerror'));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
