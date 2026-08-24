// cft-host-browser 单元测试（真实启动由 G-b fixture 覆盖，这里只测纯逻辑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findCftBinary,
  ownsProcess,
  readLaunchFile,
} from '../scripts/cft-host-browser.mjs';

test('findCftBinary: CFT_BINARY 环境变量优先', () => {
  const binary = findCftBinary({
    env: { CFT_BINARY: '/opt/cft/chrome' },
    exists: (p) => p === '/opt/cft/chrome',
  });
  assert.equal(binary, '/opt/cft/chrome');
});

test('findCftBinary: 扫描 puppeteer/agent-browser 缓存根并取最新版本', () => {
  const home = '/fake/home';
  const dirs = {
    [`${home}/.cache/puppeteer/chrome`]: ['mac_arm-113.0.5672.63', 'mac_arm-148.0.7778.97'],
    [`${home}/.agent-browser/browsers`]: ['chrome-147.0.7727.117'],
  };
  const binary = findCftBinary({
    env: { HOME: home },
    exists: () => true,
    readdir: (dir) => dirs[dir] || [],
  });
  assert.match(binary, /mac_arm-148\.0\.7778\.97/);
  assert.match(binary, /Google Chrome for Testing/);
});

test('findCftBinary: 无候选 → null（fail closed，不回退用户真 Chrome）', () => {
  const binary = findCftBinary({
    env: { HOME: '/fake/empty' },
    exists: () => false,
    readdir: () => [],
  });
  assert.equal(binary, null);
});

test('ownsProcess: cmdline 含本 profile 且为 CfT → true', () => {
  const owns = ownsProcess(
    { pid: 4321, profileDir: '/tmp/cft-profile-a', binaryPath: '/x/Google Chrome for Testing' },
    () => '/x/Google Chrome for Testing --user-data-dir=/tmp/cft-profile-a --remote-debugging-port=9229',
  );
  assert.equal(owns, true);
});

test('ownsProcess: cmdline 属于别的 profile → false（拒绝 kill）', () => {
  const owns = ownsProcess(
    { pid: 4321, profileDir: '/tmp/cft-profile-a', binaryPath: '/x/Google Chrome for Testing' },
    () => '/x/Google Chrome for Testing --user-data-dir=/tmp/other-profile --remote-debugging-port=9229',
  );
  assert.equal(owns, false);
});

test('ownsProcess: 进程已退出（ps 空）→ false', () => {
  const owns = ownsProcess({ pid: 99999, profileDir: '/tmp/cft-profile-a' }, () => '');
  assert.equal(owns, false);
});

test('ownsProcess: 用户真 Chrome 开了同路径 profile 字样但非 CfT → false', () => {
  const owns = ownsProcess(
    { pid: 1, profileDir: '/tmp/cft-profile-a', binaryPath: '/x/Google Chrome for Testing' },
    () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/cft-profile-a',
  );
  assert.equal(owns, false);
});

test('readLaunchFile: 合法记录往返', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cft-launch-test-'));
  fs.writeFileSync(path.join(dir, 'cft-launch.json'), JSON.stringify({ pid: 123, port: 9229, profileDir: dir }));
  const record = readLaunchFile(dir);
  assert.equal(record.pid, 123);
  assert.equal(record.port, 9229);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readLaunchFile: 缺文件/坏 JSON/缺字段 → null', () => {
  assert.equal(readLaunchFile('/nonexistent-dir-xyz'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cft-launch-test-'));
  fs.writeFileSync(path.join(dir, 'cft-launch.json'), '{broken');
  assert.equal(readLaunchFile(dir), null);
  fs.writeFileSync(path.join(dir, 'cft-launch.json'), JSON.stringify({ pid: 'abc' }));
  assert.equal(readLaunchFile(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
