import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';

import { isConnectedProxyHealth } from '../scripts/check-deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_DEPS = path.join(ROOT, 'scripts', 'check-deps.mjs');

function runCheckDeps(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECK_DEPS, '--browser', 'edge'], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('isConnectedProxyHealth only accepts an explicitly connected healthy proxy', () => {
  assert.equal(isConnectedProxyHealth({ status: 'ok', connected: true }), true);
  assert.equal(isConnectedProxyHealth({ status: 'ok', connected: false }), false);
  assert.equal(isConnectedProxyHealth({ status: 'ok', connected: 'true' }), false);
  assert.equal(isConnectedProxyHealth({ status: 'error', connected: true }), false);
});

test('check-deps accepts a connected proxy before sandbox browser discovery', async (t) => {
  const hostHome = await mkdtemp(path.join(os.tmpdir(), 'web-access-empty-home-'));
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/health');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'ok',
      connected: true,
      browser: { id: 'chrome', label: 'Chrome' },
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(hostHome, { recursive: true, force: true });
  });

  const result = await runCheckDeps({
    CDP_PROXY_PORT: String(port),
    WEB_ACCESS_HOST_HOME: hostHome,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /proxy: ready \(Chrome\)/);
  assert.doesNotMatch(result.stdout, /browser:/);
});
