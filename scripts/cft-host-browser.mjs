#!/usr/bin/env node
// cft-host-browser — task-owned headful Chrome for Testing 启动器（pre-DNS Host 映射专用）
//
// 用途（ENV-ROUTER-01 / S15-PRE-G-b 唯一 sanctioned headful 场景）：
//   本地 pre-DNS 多域名 Host 路由验证需要 --host-resolver-rules launch flag，
//   ego 运行实例无法补 flag，因此由本启动器开一个独立 CfT 实例：
//     - task-owned --user-data-dir（绝不碰用户真实 profile）
//     - 非默认调试端口（默认 9229，备选 9333；绝不占 9222）
//     - headful（本 lane 特例；其余所有场景一律 headless/附着）
//   启动后写 <profile>/cft-launch.json（pid/port/rules/startedAt），
//   stop 时先核对进程 cmdline 确属本 profile 才 SIGTERM——只杀自己起的进程。
//
// 配套消费：另起一个非默认 cdp-proxy（CDP_PROXY_PORT=34xx --browser=chrome），
// discovery 的 fallback 会命中 9229/9333 并用 Browser.getVersion 验明 Chrome/ 产品。
//
// 用法：
//   node cft-host-browser.mjs start --profile <dir> --host-resolver-rules "MAP h 127.0.0.1" [--port 9229] [--url about:blank]
//   node cft-host-browser.mjs status --profile <dir>
//   node cft-host-browser.mjs stop --profile <dir> [--clean]

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const LAUNCH_FILE = 'cft-launch.json';
const DEFAULT_PORT = 9229;

// --- CfT binary 发现（环境变量优先，其次已知缓存根，取版本号最大者）---
export function findCftBinary({ env = process.env, platform = os.platform(), exists = fs.existsSync, readdir, join = path.join } = {}) {
  if (env.CFT_BINARY && exists(env.CFT_BINARY)) return env.CFT_BINARY;
  if (platform !== 'darwin') return null;

  const home = env.HOME || os.homedir();
  const candidates = [];
  const scanRoots = [
    { root: join(home, '.cache/puppeteer/chrome'), suffix: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' },
    { root: join(home, '.agent-browser/browsers'), suffix: 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' },
  ];
  const read = readdir || ((dir) => { try { return fs.readdirSync(dir); } catch { return []; } });
  for (const { root, suffix } of scanRoots) {
    for (const entry of read(root)) {
      const binary = join(root, entry, suffix);
      if (exists(binary)) candidates.push(binary);
    }
  }
  if (!candidates.length) return null;
  // 版本目录形如 mac_arm-148.0.7778.97 / chrome-147.0.7727.117，按数字段比较取最新。
  const versionKey = (binary) => {
    const match = binary.match(/(\d+(?:\.\d+){1,3})/);
    return match ? match[1].split('.').map(Number) : [0];
  };
  candidates.sort((a, b) => {
    const va = versionKey(a); const vb = versionKey(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const diff = (vb[i] || 0) - (va[i] || 0);
      if (diff) return diff;
    }
    return 0;
  });
  return candidates[0];
}

// --- stop 安全闸：只杀 cmdline 确属本 profile 的进程 ---
// psTextProvider: (pid) => string（可注入测试）；返回 true 表示该 pid 确实是本启动器起的 CfT。
export function ownsProcess({ pid, profileDir, binaryPath }, psTextProvider = defaultPsText) {
  const text = psTextProvider(pid);
  if (!text) return false;
  return text.includes(profileDir) && (!binaryPath || text.includes('Chrome for Testing'));
}

function defaultPsText(pid) {
  try {
    return execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function isLive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function launchFilePath(profileDir) {
  return path.join(profileDir, LAUNCH_FILE);
}

export function readLaunchFile(profileDir, { readFile = fs.readFileSync } = {}) {
  try {
    const value = JSON.parse(readFile(launchFilePath(profileDir), 'utf8'));
    if (!Number.isInteger(value?.pid) || !Number.isInteger(value?.port)) return null;
    return value;
  } catch {
    return null;
  }
}

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`CfT 调试端口 ${port} 在 ${timeoutMs}ms 内未监听`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[arg.slice(2)] = argv[++i];
      else args[arg.slice(2)] = true;
    } else args._.push(arg);
  }
  return args;
}

async function start(args) {
  const profileDir = args.profile && path.resolve(args.profile);
  const rules = args['host-resolver-rules'];
  if (!profileDir || !rules) {
    throw new Error('start 需要 --profile <dir> 与 --host-resolver-rules "MAP <host> 127.0.0.1"');
  }
  const port = Number.parseInt(args.port || DEFAULT_PORT, 10);
  if (!(port > 0 && port < 65536) || port === 9222) {
    throw new Error('调试端口必须是非 9222 的合法端口（默认 9229）');
  }
  const existing = readLaunchFile(profileDir);
  if (existing && isLive(existing.pid)) {
    console.log(JSON.stringify({ status: 'already-running', ...existing }));
    return;
  }
  const binary = findCftBinary();
  if (!binary) {
    throw new Error('未找到 Chrome for Testing binary；设 CFT_BINARY 或安装到 ~/.cache/puppeteer/chrome 或 ~/.agent-browser/browsers');
  }
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(binary, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    `--host-resolver-rules=${rules}`,
    '--no-first-run',
    '--no-default-browser-check',
    // headful：本 lane 是资源纪律唯一允许的弹窗场景（pre-DNS Host 路由验证）
    args.url || 'about:blank',
  ], { stdio: 'ignore', detached: false });
  child.unref();
  await waitForPort(port);
  const record = {
    pid: child.pid,
    port,
    profileDir,
    binary,
    hostResolverRules: rules,
    headful: true,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(launchFilePath(profileDir), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: 'started', ...record }));
}

function status(args) {
  const profileDir = args.profile && path.resolve(args.profile);
  const record = profileDir && readLaunchFile(profileDir);
  if (!record) {
    console.log(JSON.stringify({ status: 'not-running' }));
    return;
  }
  console.log(JSON.stringify({ status: isLive(record.pid) ? 'running' : 'stale', ...record }));
}

function stop(args) {
  const profileDir = args.profile && path.resolve(args.profile);
  if (!profileDir) throw new Error('stop 需要 --profile <dir>');
  const record = readLaunchFile(profileDir);
  if (!record) {
    console.log(JSON.stringify({ status: 'not-running' }));
    return;
  }
  if (isLive(record.pid)) {
    if (!ownsProcess({ pid: record.pid, profileDir: record.profileDir, binaryPath: record.binary })) {
      throw new Error(`pid ${record.pid} 的 cmdline 不属于本 profile，拒绝 kill（只杀自己起的进程）`);
    }
    process.kill(record.pid, 'SIGTERM');
  }
  try { fs.unlinkSync(launchFilePath(profileDir)); } catch { /* best effort */ }
  if (args.clean) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(JSON.stringify({ status: 'stopped', pid: record.pid, profileDir: record.profileDir }));
}

// --- CLI entry（import 时不执行）---
const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    if (command === 'start') await start(args);
    else if (command === 'status') status(args);
    else if (command === 'stop') stop(args);
    else {
      console.error('用法: cft-host-browser.mjs start|status|stop --profile <dir> [--host-resolver-rules ...] [--port 9229] [--clean]');
      process.exit(1);
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', error: error.message }));
    process.exit(1);
  }
}
