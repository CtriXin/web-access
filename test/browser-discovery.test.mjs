import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';

import {
  fallbackPortCandidates,
  fallbackWsPath,
  findProxyOccupiedPorts,
  isDefaultBrowserPort,
  registerProxyPort,
  unregisterProxyPort,
  productMatchesBrowser,
  validateBrowserProduct,
} from '../scripts/browser-discovery.mjs';

test('fixed-port fallback only accepts the configured browser product', () => {
  assert.equal(productMatchesBrowser('Chrome/150.0.0.0', 'chrome'), true);
  assert.equal(productMatchesBrowser('Edg/150.0.0.0', 'edge'), true);
  assert.equal(productMatchesBrowser('Chrome/150.0.0.0', 'edge'), false);
  assert.equal(productMatchesBrowser('Edg/150.0.0.0', 'chrome'), false);
  assert.equal(productMatchesBrowser('Chrome/150.0.0.0', 'chrome-canary'), false);
});

test('ego lite is a first-class browser that self-reports a Chrome product', async () => {
  // ego 的 Browser.getVersion 自报 Chrome/<version>（实测 150.0.7871.101），与真 Chrome 同前缀；
  // 身份由 DevToolsActivePort 所在的 Citro Labs 路径保证，不能靠 product 区分。
  assert.equal(productMatchesBrowser('Chrome/150.0.7871.101', 'ego'), true);
  assert.equal(productMatchesBrowser('Edg/150.0.0.0', 'ego'), false);
  assert.equal(productMatchesBrowser('chromium/150.0.0.0', 'ego'), false);
  assert.doesNotThrow(() => validateBrowserProduct('Chrome/150.0.7871.101', 'ego'));
  assert.throws(
    () => validateBrowserProduct('Edg/150.0.0.0', 'ego'),
    /与请求的 ego 不一致.*拒绝附着/
  );

  if (os.platform() === 'darwin') {
    const { knownBrowsers } = await import('../scripts/browser-discovery.mjs');
    const ego = knownBrowsers().find((browser) => browser.id === 'ego');
    assert.ok(ego, 'darwin knownBrowsers must register ego');
    assert.equal(ego.label, 'ego lite');
    assert.ok(
      ego.devToolsPath.endsWith(path.join('Citro Labs', 'ego lite', 'DevToolsActivePort')),
      `unexpected ego DevToolsActivePort path: ${ego.devToolsPath}`
    );
  }
});

test("non-default proxy fallback never probes the user's default browser port", () => {
  assert.deepEqual(fallbackPortCandidates({ proxyPort: 3456 }), [9222, 9229, 9333]);
  assert.deepEqual(fallbackPortCandidates({ proxyPort: 3457 }), []);
  assert.deepEqual(fallbackPortCandidates({ proxyPort: 3457, browserOverride: 'chromium' }), [9229, 9333]);
  assert.equal(isDefaultBrowserPort(9222), true);
  assert.equal(isDefaultBrowserPort(9229), false);
});

test('healthy proxy registry marks its browser port as occupied', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/health');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', connected: true, chromePort: 9222 }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const occupied = await findProxyOccupiedPorts({
    currentProxyPort: 3456,
    healthPorts: [port],
  });

  assert.equal(occupied.has(9222), true);
});

test('proxy registry excludes its own browser port and blocks another live proxy', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'web-access-proxy-registry-'));
  const registryFile = path.join(tempDir, 'proxies.json');
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  registerProxyPort({ proxyPort: 3458, browserPort: 9333, registryFile });
  const occupiedByOther = await findProxyOccupiedPorts({
    currentProxyPort: 3457,
    registryFile,
    healthPorts: [],
  });
  const occupiedBySelf = await findProxyOccupiedPorts({
    currentProxyPort: 3458,
    registryFile,
    healthPorts: [],
  });

  assert.equal(occupiedByOther.has(9333), true);
  assert.equal(occupiedBySelf.has(9333), false);
  unregisterProxyPort({ proxyPort: 3458, registryFile });
});

test('fallbackWsPath extracts the UUID path from /json/version (modern Chrome rejects bare /devtools/browser)', async () => {
  const fetchImpl = async (url) => ({
    json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/browser/4de159ee-be1f-468e-8679-32d3481ca6f3' }),
  });
  assert.equal(await fallbackWsPath(9229, { fetchImpl }), '/devtools/browser/4de159ee-be1f-468e-8679-32d3481ca6f3');
});

test('fallbackWsPath fails closed on non-browser endpoints / bad payloads', async () => {
  // 非 CDP 端口（如普通 HTTP 服务）→ null，不假装可用
  assert.equal(await fallbackWsPath(9229, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), null);
  // 缺 webSocketDebuggerUrl → null
  assert.equal(await fallbackWsPath(9229, { fetchImpl: async () => ({ json: async () => ({}) }) }), null);
  // 路径不含 /devtools/browser/<uuid> → null
  assert.equal(await fallbackWsPath(9229, { fetchImpl: async () => ({ json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/other' }) }) }), null);
  // 无 fetch 实现 → null
  assert.equal(await fallbackWsPath(9229, { fetchImpl: null }), null);
});

test('unknown fallback products fail closed with a user-Chrome diagnostic', () => {
  assert.throws(
    () => validateBrowserProduct('Chrome/150.0.0.0', 'chromium'),
    /疑似用户真 Chrome.*拒绝附着/
  );
  assert.throws(
    () => validateBrowserProduct('Firefox/150.0', 'unknown'),
    /疑似用户真 Chrome.*拒绝附着/
  );
  assert.doesNotThrow(() => validateBrowserProduct('Chrome/150.0.0.0', 'unknown'));
  assert.doesNotThrow(() => validateBrowserProduct('Chrome/150.0.0.0', 'chrome-canary'));
  assert.throws(
    () => validateBrowserProduct('Edg/150.0.0.0', 'chrome-canary'),
    /疑似用户真 Chrome.*拒绝附着/
  );
});
