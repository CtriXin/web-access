import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';

import {
  fallbackPortCandidates,
  findProxyOccupiedPorts,
  isDefaultBrowserPort,
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
});
