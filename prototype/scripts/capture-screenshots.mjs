import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, resolvePlaywrightUrl } from './browser-runtime.mjs';

export { launchBrowser, resolvePlaywrightUrl } from './browser-runtime.mjs';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputDirectory = resolve(scriptDirectory, '../../artifacts/screenshots');

const captureNames = [
  '01-lifecycle.png',
  '02-council.png',
  '03-policy.png',
  '04-crisis.png',
  '05-advisor.png',
];

async function saveScreenshot(page, outputDirectory, name) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  await page.waitForFunction(() => window.scrollX === 0 && window.scrollY === 0);
  const path = join(outputDirectory, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

export async function assertCapturePngSet(outputDirectory, { requireAll = true } = {}) {
  let entries = [];
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pngNames = entries.filter((entry) => entry.isFile() && /\.png$/i.test(entry.name)).map((entry) => entry.name).sort();
  const unexpected = pngNames.filter((name) => !captureNames.includes(name));
  if (unexpected.length > 0) throw new Error(`Unexpected PNG files: ${unexpected.join(', ')}`);
  if (requireAll) {
    const missing = captureNames.filter((name) => !pngNames.includes(name));
    if (missing.length > 0) throw new Error(`Missing required PNG files: ${missing.join(', ')}`);
  }
  return pngNames;
}

async function defaultBrowserProvider() {
  const { chromium } = await import(await resolvePlaywrightUrl());
  return launchBrowser(chromium);
}

export async function prepareCaptureBrowser(outputDirectory, { browserProvider = defaultBrowserProvider } = {}) {
  await assertCapturePngSet(outputDirectory, { requireAll: false });
  await mkdir(outputDirectory, { recursive: true });
  return browserProvider();
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Capture is not a valid PNG file.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export async function capturePresentationScreenshots({
  baseUrl = process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:4173',
  outputDirectory = defaultOutputDirectory,
  browserProvider = defaultBrowserProvider,
} = {}) {
  const browser = await prepareCaptureBrowser(outputDirectory, { browserProvider });
  const browserErrors = [];
  const paths = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      throw new Error(`Prototype unavailable at ${baseUrl}. Start it with \`node prototype/server.mjs\`.`, { cause: error });
    }
    await page.locator('[data-ready="true"]').waitFor();
    paths.push(await saveScreenshot(page, outputDirectory, captureNames[0]));

    await page.locator('[data-council-trace] > summary').first().click();
    paths.push(await saveScreenshot(page, outputDirectory, captureNames[1]));

    await page.locator('[data-policy-comparison] > summary').click();
    await page.locator('[data-official-policy-link]').first().waitFor();
    paths.push(await saveScreenshot(page, outputDirectory, captureNames[2]));

    const marketScenarios = page.locator('[data-market-scenarios]');
    const marketBefore = await marketScenarios.textContent();
    await page.locator('[data-action="simulate-cost-spike"]').click();
    await page.locator('[data-immediate-alert]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      ([selector, previous]) => document.querySelector(selector)?.textContent !== previous,
      ['[data-market-scenarios]', marketBefore],
    );
    paths.push(await saveScreenshot(page, outputDirectory, captureNames[3]));

    await page.locator('[data-action="open-advisor-consent"]').click();
    await page.getByRole('dialog', { name: /.+/ }).waitFor({ state: 'visible' });
    paths.push(await saveScreenshot(page, outputDirectory, captureNames[4]));

    if (browserErrors.length > 0) throw new Error(`Browser errors detected:\n${browserErrors.join('\n')}`);
  } finally {
    await browser.close();
  }

  await assertCapturePngSet(outputDirectory);

  const captures = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    const dimensions = pngDimensions(bytes);
    if (bytes.length === 0 || dimensions.width < 1200) {
      throw new Error(`Invalid presentation capture ${path}: ${bytes.length} bytes, ${dimensions.width}px wide.`);
    }
    captures.push({ path, bytes: bytes.length, ...dimensions });
  }
  return captures;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const captures = await capturePresentationScreenshots();
  for (const capture of captures) {
    console.log(`${capture.path} (${capture.width}x${capture.height}, ${capture.bytes} bytes)`);
  }
}
