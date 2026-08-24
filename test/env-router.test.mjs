// env-router 路由边界与截图降级测试（S15-PRE-G-b）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CFT_LANE,
  EGO_LANE,
  captureVisualEvidence,
  routeBrowser,
} from '../scripts/env-router.mjs';

// --- 正向路由：production / visual / behavior → ego ---
for (const intent of ['production', 'visual', 'behavior']) {
  test(`routeBrowser: ${intent} 走 ego lane`, () => {
    const decision = routeBrowser({ intent });
    assert.equal(decision.kind, 'route');
    assert.equal(decision.lane, 'ego');
    assert.equal(decision.browser, 'ego');
    assert.equal(decision.headful, false);
  });
}

// --- 正向路由：pre-DNS Host 映射 → 独立 headful CfT（task-owned profile + host-resolver-rules）---
test('routeBrowser: pre-dns-host-mapping 走 headful CfT lane', () => {
  const decision = routeBrowser({ intent: 'pre-dns-host-mapping' });
  assert.equal(decision.kind, 'route');
  assert.equal(decision.lane, 'cft');
  assert.equal(decision.headful, true);
  assert.equal(decision.profile, 'task-owned');
  assert.equal(decision.requiredLaunchFlag, '--host-resolver-rules');
  assert.ok(decision.debugPortCandidates.includes(9229));
  assert.ok(!decision.debugPortCandidates.includes(9222));
});

test('routeBrowser: requiresHostResolverRules=true 视同 pre-dns（即使 intent 是 production）', () => {
  const decision = routeBrowser({ intent: 'production', requiresHostResolverRules: true });
  assert.equal(decision.kind, 'route');
  assert.equal(decision.lane, 'cft');
});

// --- 负例：选错方向必须 actionable blocked，绝不静默换道 ---
test('routeBrowser: 强制 ego 跑 pre-DNS Host 映射 → blocked（ego 补不了 launch flag）', () => {
  const decision = routeBrowser({ intent: 'pre-dns-host-mapping', forced: 'ego' });
  assert.equal(decision.kind, 'blocked');
  assert.equal(decision.requestedLane, 'ego');
  assert.equal(decision.requiredLane, 'cft');
  assert.match(decision.reason, /launch flag/);
  assert.match(decision.action, /cft-host-browser/);
});

test('routeBrowser: 强制 CfT 跑 production → blocked（方向相反，无登录态）', () => {
  const decision = routeBrowser({ intent: 'production', forced: 'cft' });
  assert.equal(decision.kind, 'blocked');
  assert.equal(decision.requestedLane, 'cft');
  assert.equal(decision.requiredLane, 'ego');
  assert.match(decision.action, /ego/);
});

test('routeBrowser: 未知 intent → blocked', () => {
  const decision = routeBrowser({ intent: 'scrape' });
  assert.equal(decision.kind, 'blocked');
  assert.match(decision.action, /intent/);
});

test('routeBrowser: 未知 forced lane → blocked', () => {
  const decision = routeBrowser({ intent: 'production', forced: 'playwright' });
  assert.equal(decision.kind, 'blocked');
});

// --- 截图降级 ---
test('captureVisualEvidence: helper 成功 → via=helper', async () => {
  const result = await captureVisualEvidence({
    helperCapture: async () => ({ file: '/tmp/a.png', bytes: 123 }),
    cdpCapture: async () => { throw new Error('不应被调用'); },
  });
  assert.equal(result.status, 'captured');
  assert.equal(result.via, 'helper');
  assert.equal(result.value.bytes, 123);
});

test('captureVisualEvidence: helper 超时 → 自动降级 CDP primitive', async () => {
  const result = await captureVisualEvidence({
    helperTimeoutMs: 50,
    helperCapture: () => new Promise(() => {}), // 永不 resolve = helper 层 hang（ego 已知 bug 形态）
    cdpCapture: async () => ({ file: '/tmp/b.png', bytes: 456 }),
  });
  assert.equal(result.status, 'captured');
  assert.equal(result.via, 'cdp-degraded');
  assert.match(result.helperError, /timed out/);
  assert.equal(result.value.bytes, 456);
});

test('captureVisualEvidence: helper 抛错 → 降级 CDP', async () => {
  const result = await captureVisualEvidence({
    helperCapture: async () => { throw new Error('helper exploded'); },
    cdpCapture: async () => ({ file: '/tmp/c.png', bytes: 1 }),
  });
  assert.equal(result.status, 'captured');
  assert.equal(result.via, 'cdp-degraded');
  assert.match(result.helperError, /helper exploded/);
});

test('captureVisualEvidence: 两层都失败 → blocked，不伪造 PASS', async () => {
  const result = await captureVisualEvidence({
    helperCapture: async () => { throw new Error('helper down'); },
    cdpCapture: async () => { throw new Error('cdp down'); },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.value, undefined);
  assert.match(result.helperError, /helper down/);
  assert.match(result.cdpError, /cdp down/);
  assert.match(result.action, /伪造/);
});

test('captureVisualEvidence: helper 返回空值 → 视为失败并降级', async () => {
  const result = await captureVisualEvidence({
    helperCapture: async () => null,
    cdpCapture: async () => ({ file: '/tmp/d.png', bytes: 9 }),
  });
  assert.equal(result.via, 'cdp-degraded');
});

test('captureVisualEvidence: 缺 callable → blocked', async () => {
  const result = await captureVisualEvidence({ helperCapture: null, cdpCapture: null });
  assert.equal(result.status, 'blocked');
});

// --- lane 常量形状回归 ---
test('lane 常量: CfT 是唯一 headful lane，ego 永不 headful', () => {
  assert.equal(CFT_LANE.headful, true);
  assert.equal(EGO_LANE.headful, false);
  assert.equal(CFT_LANE.profile, 'task-owned');
});
