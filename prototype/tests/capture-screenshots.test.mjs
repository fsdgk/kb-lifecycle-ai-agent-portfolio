import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Playwright resolution accepts a portable node_modules candidate', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'kb-playwright-resolution-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(fixture, { recursive: true, force: true })));
  const nodeModules = join(fixture, 'node_modules');
  await mkdir(join(nodeModules, 'playwright'), { recursive: true });
  await writeFile(join(nodeModules, 'playwright', 'index.mjs'), 'export const fixture = true;');

  const capture = await import('../scripts/capture-screenshots.mjs');
  const resolvedUrl = await capture.resolvePlaywrightUrl({ candidates: [nodeModules] });

  assert.equal(resolvedUrl, pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href);
});

test('browser launch falls back after the managed Chromium launch is unavailable', async () => {
  const expectedBrowser = { source: 'installed Chrome' };
  const chromium = {
    async launch(options) {
      if (options.channel === 'chrome') return expectedBrowser;
      throw new Error('managed Chromium missing');
    },
  };

  const capture = await import('../scripts/capture-screenshots.mjs');
  const browser = await capture.launchBrowser(chromium, { executableCandidates: [], channels: ['chrome'] });

  assert.equal(browser, expectedBrowser);
});

test('capture set validation rejects an unexpected PNG without deleting it', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'kb-capture-set-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(fixture, { recursive: true, force: true })));
  const unexpectedPath = join(fixture, 'unexpected.png');
  await writeFile(unexpectedPath, 'not deleted');

  const capture = await import('../scripts/capture-screenshots.mjs');
  await assert.rejects(
    () => capture.assertCapturePngSet(fixture, { requireAll: false }),
    /Unexpected PNG files: unexpected\.png/,
  );
  assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(unexpectedPath, 'utf8')), 'not deleted');
});

test('capture preflight rejects an unexpected PNG before browser launch', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'kb-capture-preflight-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(fixture, { recursive: true, force: true })));
  await writeFile(join(fixture, 'unexpected.png'), 'leave intact');
  let launchAttempted = false;

  const capture = await import('../scripts/capture-screenshots.mjs');
  await assert.rejects(
    () => capture.prepareCaptureBrowser(fixture, {
      browserProvider: async () => {
        launchAttempted = true;
        return {};
      },
    }),
    /Unexpected PNG files: unexpected\.png/,
  );

  assert.equal(launchAttempted, false);
});

test('capture closes the browser when page creation fails', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'kb-capture-new-page-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(fixture, { recursive: true, force: true })));
  let closeCount = 0;
  const browser = {
    async newPage() { throw new Error('newPage failed'); },
    async close() { closeCount += 1; },
  };

  const capture = await import('../scripts/capture-screenshots.mjs');
  await assert.rejects(
    () => capture.capturePresentationScreenshots({
      outputDirectory: fixture,
      browserProvider: async () => browser,
    }),
    /newPage failed/,
  );

  assert.equal(closeCount, 1);
});
