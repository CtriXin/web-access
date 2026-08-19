// 浏览器 CDP 端口发现 + 选择 - 单一职责模块
// 被 check-deps.mjs 和 cdp-proxy.mjs 共享。
//
// 选择规则（resolution）：
//   1. 调用方传入 override 参数（来自命令行 --browser） → 严格模式，找不到则硬错
//   2. config.env 里 WEB_ACCESS_BROWSER 设了 → 严格模式，找不到则硬错
//   3. 都没设 → "ask" 模式，提示调用方询问用户
//
// 不擅自降级：偏好不可用一律硬错，让用户介入。
// 持久态只有 config.env 一处；override 是单次 spawn 通过命令行参数表达，不读 process.env。

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(SKILL_ROOT, 'config.env');
const DEFAULT_PROXY_PORT = 3456;
const DEFAULT_BROWSER_PORT = 9222;
const FALLBACK_PORTS = [DEFAULT_BROWSER_PORT, 9229, 9333];
const DEFAULT_PROXY_HEALTH_PORTS = [DEFAULT_PROXY_PORT, 3457, 3458, 3459, 3460, 3461, 3462, 3463];
const DEFAULT_PROXY_REGISTRY_PATH = path.join(os.tmpdir(), 'web-access-cdp-proxies.json');

function isIsolatedHome(home) {
  return /\/(?:\.mmf|\.config\/mms|\.config\/mmf|gateway\/s|sessions)\//.test(home || '');
}

// Return a host-home decision that agents can inspect. An isolated HOME is never used as a
// Chrome profile location unless an explicit host-home handoff overrides it.
export function browserEnvironment() {
  const configuredHostHome = readConfig().WEB_ACCESS_HOST_HOME;
  const explicitHome = process.env.WEB_ACCESS_HOST_HOME || process.env.HOST_HOME || process.env.REAL_HOME || configuredHostHome;
  if (explicitHome) return { hostHome: explicitHome, source: 'explicit', isolated: false };

  const processHome = os.homedir();
  if (!isIsolatedHome(processHome)) return { hostHome: processHome, source: 'system', isolated: false };

  return { hostHome: null, source: 'missing', isolated: true, processHome };
}

function browserHome() {
  return browserEnvironment().hostHome;
}

function parsePort(value) {
  const port = Number.parseInt(String(value ?? ''), 10);
  return port > 0 && port < 65536 ? port : null;
}

export function getProxyPort(value = process.env.CDP_PROXY_PORT) {
  return parsePort(value) || DEFAULT_PROXY_PORT;
}

export function isDefaultProxyInstance(proxyPort = getProxyPort()) {
  return getProxyPort(proxyPort) === DEFAULT_PROXY_PORT;
}

export function isDefaultBrowserPort(browserPort) {
  return parsePort(browserPort) === DEFAULT_BROWSER_PORT;
}

// Non-default proxies must name their browser explicitly and never probe the user's default 9222 port.
export function fallbackPortCandidates({ proxyPort = getProxyPort(), browserOverride = null } = {}) {
  if (!isDefaultProxyInstance(proxyPort) && !browserOverride) return [];
  return FALLBACK_PORTS.filter((port) =>
    isDefaultProxyInstance(proxyPort) || port !== DEFAULT_BROWSER_PORT
  );
}

// 加新浏览器：只改这里
export function knownBrowsers() {
  const home = browserHome();
  if (!home) return [];
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        { id: 'chrome',        label: 'Chrome',         devToolsPath: path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort') },
        { id: 'chrome-canary', label: 'Chrome Canary',  devToolsPath: path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort') },
        { id: 'chromium',      label: 'Chromium',       devToolsPath: path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort') },
        { id: 'edge',          label: 'Microsoft Edge', devToolsPath: path.join(home, 'Library/Application Support/Microsoft Edge/DevToolsActivePort') },
      ];
    case 'linux':
      return [
        { id: 'chrome',   label: 'Chrome',         devToolsPath: path.join(home, '.config/google-chrome/DevToolsActivePort') },
        { id: 'chromium', label: 'Chromium',       devToolsPath: path.join(home, '.config/chromium/DevToolsActivePort') },
        { id: 'edge',     label: 'Microsoft Edge', devToolsPath: path.join(home, '.config/microsoft-edge/DevToolsActivePort') },
      ];
    case 'win32':
      return [
        { id: 'chrome',   label: 'Chrome',         devToolsPath: path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort') },
        { id: 'chromium', label: 'Chromium',       devToolsPath: path.join(localAppData, 'Chromium/User Data/DevToolsActivePort') },
        { id: 'edge',     label: 'Microsoft Edge', devToolsPath: path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort') },
      ];
    default:
      return [];
  }
}

// TCP 端口监听检测。仅用于快速排除未监听端口，不能证明它是 CDP。
export function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error',   () => { clearTimeout(timer); resolve(false); });
  });
}

export function productMatchesBrowser(product, browserId) {
  const value = String(product || '').toLowerCase();
  switch (browserId) {
    case 'chrome': return value.startsWith('chrome/');
    case 'chromium': return value.startsWith('chromium/');
    case 'edge': return value.startsWith('edg/');
    // Browser.getVersion cannot reliably distinguish Chrome Canary from Chrome.
    case 'chrome-canary': return false;
    default: return false;
  }
}

export function isSupportedBrowserProduct(product) {
  const value = String(product || '').toLowerCase();
  return value.startsWith('chrome/')
    || value.startsWith('chromium/')
    || value.startsWith('edg/');
}

export function validateBrowserProduct(product, browserId = 'unknown') {
  // Chrome Canary reports the same product prefix as Chrome, so identity cannot be proven here.
  if (browserId === 'chrome-canary') return true;
  if (browserId && browserId !== 'unknown' && !productMatchesBrowser(product, browserId)) {
    throw new Error(
      `固定端口返回 ${product}，与请求的 ${browserId} 不一致；疑似用户真 Chrome 或错误浏览器端口，已拒绝附着。`
    );
  }
  if ((!browserId || browserId === 'unknown') && !isSupportedBrowserProduct(product)) {
    throw new Error(
      `固定端口返回 ${product}，不是受支持的 Chrome/Chromium/Edge CDP 产品；疑似用户真 Chrome 或非浏览器端口，已拒绝附着。`
    );
  }
  return true;
}

function registryPath(filePath) {
  return filePath || process.env.CDP_PROXY_REGISTRY_FILE || DEFAULT_PROXY_REGISTRY_PATH;
}

function isLiveProcess(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readProxyRegistry(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(registryPath(filePath), 'utf8'));
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => ({
        pid: Number(entry?.pid),
        proxyPort: parsePort(entry?.proxyPort),
        browserPort: parsePort(entry?.browserPort),
      }))
      .filter((entry) => entry.proxyPort && entry.browserPort && isLiveProcess(entry.pid));
  } catch {
    return [];
  }
}

function writeProxyRegistry(entries, filePath) {
  const target = registryPath(filePath);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    if (!entries.length) {
      try { fs.unlinkSync(target); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return;
    }
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

export function registerProxyPort({ proxyPort = getProxyPort(), browserPort, pid = process.pid, registryFile } = {}) {
  const normalizedProxyPort = parsePort(proxyPort);
  const normalizedBrowserPort = parsePort(browserPort);
  if (!normalizedProxyPort || !normalizedBrowserPort) return;
  const entries = readProxyRegistry(registryFile)
    .filter((entry) => !(entry.pid === Number(pid) && entry.proxyPort === normalizedProxyPort));
  entries.push({ pid: Number(pid), proxyPort: normalizedProxyPort, browserPort: normalizedBrowserPort });
  writeProxyRegistry(entries, registryFile);
}

export function unregisterProxyPort({ proxyPort = getProxyPort(), browserPort, pid = process.pid, registryFile } = {}) {
  const normalizedProxyPort = parsePort(proxyPort);
  const normalizedBrowserPort = browserPort == null ? null : parsePort(browserPort);
  if (!normalizedProxyPort) return;
  const entries = readProxyRegistry(registryFile).filter((entry) => {
    if (entry.pid !== Number(pid) || entry.proxyPort !== normalizedProxyPort) return true;
    return normalizedBrowserPort != null && entry.browserPort !== normalizedBrowserPort;
  });
  writeProxyRegistry(entries, registryFile);
}

function configuredProxyHealthPorts(extraPorts = [], registryFile) {
  const configured = String(process.env.CDP_PROXY_KNOWN_PORTS || '')
    .split(',')
    .map(parsePort)
    .filter(Boolean);
  const registered = readProxyRegistry(registryFile).map((entry) => entry.proxyPort);
  return [...new Set([...DEFAULT_PROXY_HEALTH_PORTS, ...configured, ...extraPorts, ...registered])];
}

function readProxyHealth(proxyPort, timeoutMs = 250) {
  return new Promise((resolve) => {
    let body = '';
    const request = http.get({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/health',
      timeout: timeoutMs,
    }, (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

export async function findProxyOccupiedPorts({
  currentProxyPort = getProxyPort(),
  registryFile,
  healthPorts,
  timeoutMs = 250,
} = {}) {
  const current = getProxyPort(currentProxyPort);
  const occupied = new Set();
  const registryEntries = readProxyRegistry(registryFile);
  for (const entry of registryEntries) {
    if (entry.proxyPort !== current) occupied.add(entry.browserPort);
  }

  const registeredProxyPorts = registryEntries.map((entry) => entry.proxyPort);
  for (const candidateProxyPort of configuredProxyHealthPorts([
    ...(healthPorts || []),
    ...registeredProxyPorts,
  ], registryFile)) {
    if (candidateProxyPort === current) continue;
    const health = await readProxyHealth(candidateProxyPort, timeoutMs);
    const browserPort = parsePort(health?.chromePort);
    if (health?.status === 'ok' && health?.connected === true && browserPort) {
      occupied.add(browserPort);
    }
  }
  return occupied;
}

// 读 config.env 文件（不写入 process.env，分清来源）
// 格式：KEY=VALUE，# 开头是注释
function readConfig() {
  const cfg = {};
  let content;
  try { content = fs.readFileSync(CONFIG_PATH, 'utf8'); }
  catch { return cfg; }
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k && v) cfg[k] = v;
  }
  return cfg;
}

// DevToolsActivePort gives the target WebSocket path; the proxy performs the CDP handshake.
async function detectAll() {
  const result = [];
  for (const browser of knownBrowsers()) {
    let content;
    try { content = fs.readFileSync(browser.devToolsPath, 'utf8'); }
    catch { continue; }
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const port = parseInt(lines[0], 10);
    if (!(port > 0 && port < 65536)) continue;
    if (!(await checkPort(port))) continue;
    result.push({ ...browser, port, wsPath: lines[1] || null });
  }
  return result;
}

// 决策入口
// 参数：override — 调用方解析自命令行 --browser 的值（null 表示未传）
// 返回 { kind, browser?, source?, detected, configured, override? }
//   kind ∈ 'ok' | 'ambiguous' | 'mismatch' | 'blocked' | 'empty'
//   source ∈ 'override' | 'preference' | undefined
//   ambiguous = 没设偏好 + 至少一个浏览器开了 toggle，需问用户
//   mismatch  = override/配偏好设了但未检测到对应 toggle，硬错
//   empty     = 0 浏览器开 toggle 且未设偏好/override
//   blocked   = 非默认 proxy 未提供显式 browser override
export async function selectBrowser(override = null) {
  const allDetected = await detectAll();
  const occupied = await findProxyOccupiedPorts({ currentProxyPort: getProxyPort() });
  const detected = allDetected
    .filter((browser) => !occupied.has(browser.port))
    .filter((browser) => isDefaultProxyInstance() || !isDefaultBrowserPort(browser.port));
  const configured = readConfig().WEB_ACCESS_BROWSER || null;

  if (!isDefaultProxyInstance() && !override) {
    return {
      kind: 'blocked',
      reason: '非默认 CDP proxy 实例必须显式传入 --browser，并使用非 9222 的浏览器调试端口。',
      detected,
      configured,
    };
  }

  // Browser toggles in isolated sessions may not leave DevToolsActivePort in the host profile.
  // Treat a fixed listener as a candidate; cdp-proxy verifies Browser.getVersion on its one real connection.
  const matchingFallback = async (browserId) => {
    const fallback = await findFallbackPort({
      proxyPort: getProxyPort(),
      browserOverride: override,
    });
    const browser = knownBrowsers().find((item) => item.id === browserId);
    if (!fallback || !browser) return null;
    return { ...browser, ...fallback };
  };

  // 1. 命令行 override（最高优先，单次有效）
  if (override) {
    const match = detected.find(b => b.id === override);
    if (match) return { kind: 'ok', browser: match, source: 'override', detected, configured, override };
    const fallback = await matchingFallback(override);
    if (fallback) return { kind: 'ok', browser: fallback, source: 'fallback', detected, configured, override };
    return { kind: 'mismatch', source: 'override', detected, configured, override };
  }

  // 2. config.env preference（持久）
  if (configured) {
    const match = detected.find(b => b.id === configured);
    if (match) return { kind: 'ok', browser: match, source: 'preference', detected, configured };
    const fallback = await matchingFallback(configured);
    if (fallback) return { kind: 'ok', browser: fallback, source: 'fallback', detected, configured };
    return { kind: 'mismatch', source: 'preference', detected, configured };
  }

  // 3. 无偏好 —— 一律询问用户（哪怕 detected 只有一个）
  if (detected.length === 0) {
    return { kind: 'empty', detected, configured };
  }
  return { kind: 'ambiguous', detected, configured };
}

// 兜底：扫描常用固定端口。它只是连接候选，CDP proxy 会在同一条最终连接上验证。
export async function findFallbackPort({
  proxyPort = getProxyPort(),
  browserOverride = null,
  registryFile,
  healthPorts,
} = {}) {
  const candidates = fallbackPortCandidates({ proxyPort, browserOverride });
  if (!candidates.length) return null;
  const occupied = await findProxyOccupiedPorts({
    currentProxyPort: proxyPort,
    registryFile,
    healthPorts,
  });
  for (const port of candidates) {
    if (occupied.has(port)) continue;
    if (await checkPort(port)) return { port, wsPath: null };
  }
  return null;
}
