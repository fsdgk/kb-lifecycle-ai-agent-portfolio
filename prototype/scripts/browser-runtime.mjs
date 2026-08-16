import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');

async function existingRuntimeCandidates(userHome) {
  const runtimesRoot = join(userHome, '.cache', 'codex-runtimes');
  try {
    const entries = await readdir(runtimesRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runtimesRoot, entry.name, 'dependencies', 'node', 'node_modules'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function defaultNodeModulesCandidates() {
  const userHome = homedir();
  const nodePathCandidates = (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean);
  return [
    process.env.CODEX_PRIMARY_NODE_MODULES,
    resolve(scriptDirectory, '../node_modules'),
    join(repositoryRoot, 'node_modules'),
    join(userHome, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules'),
    ...await existingRuntimeCandidates(userHome),
    ...nodePathCandidates,
  ].filter(Boolean);
}

export async function resolvePlaywrightUrl({ candidates } = {}) {
  const checked = [];
  for (const nodeModules of candidates ?? await defaultNodeModulesCandidates()) {
    const entrypoint = resolve(nodeModules, 'playwright', 'index.mjs');
    if (checked.includes(entrypoint)) continue;
    checked.push(entrypoint);
    try {
      await access(entrypoint);
      return pathToFileURL(entrypoint).href;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Bundled Playwright was not found. Set CODEX_PRIMARY_NODE_MODULES to its node_modules directory. Checked:\n${checked.join('\n')}`);
}

function defaultBrowserExecutables() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    localAppData && join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFiles && join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFiles && join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFilesX86 && join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function launchBrowser(chromium, {
  executableCandidates = defaultBrowserExecutables(),
  channels = ['chrome', 'msedge'],
} = {}) {
  const failures = [];
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    failures.push(`managed Chromium: ${error.message}`);
  }

  for (const executablePath of executableCandidates) {
    if (!await pathExists(executablePath)) continue;
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch (error) {
      failures.push(`${executablePath}: ${error.message}`);
    }
  }

  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      failures.push(`${channel} channel: ${error.message}`);
    }
  }

  throw new Error(`Unable to launch a browser with bundled Playwright.\n${failures.join('\n')}`);
}
