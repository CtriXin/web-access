// env-router — ego / CfT 永久分工的确定性路由（ENV-ROUTER-01 / S15-PRE-G-b）
//
// 分工（探测一次确定，之后不再重复探测）：
//   - production / visual / behavior（真实站附着、视觉验收、行为交互）→ ego lite
//     （Chromium 系 Agent 浏览器，复用用户登录态，WS-only CDP，见 browser-discovery）
//   - pre-DNS Host 映射验证（需要 --host-resolver-rules 等 launch flag）→ 独立 headful
//     Chrome for Testing（task-owned profile + 非默认调试端口 9229/9333）。
//     ego 运行实例无法补 launch flag，这是它的硬边界，不是偏好。
//
// 铁律：两边不做兼容 fallback。调用方显式指定的方向与路由结果不一致时，
// 必须返回 actionable blocked，绝不静默换道。
//
// 截图降级：浏览器 helper 层截图（如 ego helper captureScreenshot）失败/超时时，
// 自动降级到 CDP primitive（Page.captureScreenshot，经 cdp-proxy /screenshot）；
// 两层都失败返回明确 blocked。任何一层都不允许伪造视觉 PASS。

// 路由意图（调用方必须显式声明，不允许猜）
export const INTENTS = Object.freeze(['production', 'visual', 'behavior', 'pre-dns-host-mapping']);

export const EGO_INTENTS = Object.freeze(['production', 'visual', 'behavior']);

// CfT lane 的固定形状：headful 仅限本 lane（资源纪律），profile 必须 task-owned。
export const CFT_LANE = Object.freeze({
  lane: 'cft',
  browser: 'chrome-for-testing',
  headful: true,
  profile: 'task-owned',
  debugPortCandidates: Object.freeze([9229, 9333]),
  requiredLaunchFlag: '--host-resolver-rules',
});

export const EGO_LANE = Object.freeze({
  lane: 'ego',
  browser: 'ego',
  headful: false, // 附着用户已运行的 ego 实例，不启动新窗口进程
  profile: 'user-shared-task-space',
});

function blocked(reason, action, extra = {}) {
  return { kind: 'blocked', reason, action, ...extra };
}

function route(lane, reason, extra = {}) {
  return { kind: 'route', ...lane, reason, ...extra };
}

// 决策入口。
// 参数：
//   intent                    — INTENTS 之一（必填）
//   requiresHostResolverRules — 任务是否需要 --host-resolver-rules（true 时视同 pre-dns-host-mapping）
//   forced                    — 调用方显式指定的 lane：'ego' | 'cft' | null
// 返回 { kind: 'route', lane, browser, headful, profile, reason, ... }
//    | { kind: 'blocked', reason, action, ... }
export function routeBrowser({ intent, requiresHostResolverRules = false, forced = null } = {}) {
  if (forced !== null && forced !== 'ego' && forced !== 'cft') {
    return blocked(
      `未知的强制 lane: ${JSON.stringify(forced)}`,
      'forced 只接受 "ego" 或 "cft"；去掉 forced 让 router 按 intent 决策。',
    );
  }

  const needsHostMapping = requiresHostResolverRules === true || intent === 'pre-dns-host-mapping';

  if (!needsHostMapping && !INTENTS.includes(intent)) {
    return blocked(
      `未知 intent: ${JSON.stringify(intent)}`,
      `intent 必须是 ${INTENTS.join(' / ')} 之一；不确定时按任务性质归类后再调用。`,
    );
  }

  if (needsHostMapping) {
    if (forced === 'ego') {
      return blocked(
        '任务需要 --host-resolver-rules，但 ego 运行实例无法补 launch flag（WS-only 附着，硬边界）。',
        '改用 CfT lane：scripts/cft-host-browser.mjs start --host-resolver-rules "MAP <host> 127.0.0.1"，' +
        '再用非默认 proxy（--browser=chrome，调试端口 9229/9333）附着；或放弃 pre-DNS Host 验证。',
        { requestedLane: 'ego', requiredLane: 'cft' },
      );
    }
    return route(CFT_LANE, 'pre-DNS Host 映射需要 launch flag，ego 无法提供，走独立 headful CfT。');
  }

  // production / visual / behavior → ego
  if (forced === 'cft') {
    return blocked(
      `intent=${intent} 属于 ego lane（真实站附着/视觉/行为），CfT 是无登录态的隔离实例，方向相反。`,
      '去掉 forced=cft，用 --browser=ego 附着用户 ego 实例；只有 pre-DNS Host 映射验证才走 CfT。',
      { requestedLane: 'cft', requiredLane: 'ego' },
    );
  }
  return route(EGO_LANE, `${intent} 走 ego：复用登录态、task-owned tab 生命周期由 cdp-proxy 管理。`);
}

// --- 截图降级 ---
// helperCapture / cdpCapture 均为 () => Promise<value>（value 例如 { file, bytes }）。
// helper 层超时或抛错 → 降级 CDP；两层都失败 → blocked，绝不返回伪造的 captured。
export async function captureVisualEvidence({
  helperCapture,
  cdpCapture,
  helperTimeoutMs = 30000,
} = {}) {
  if (typeof helperCapture !== 'function' || typeof cdpCapture !== 'function') {
    return {
      status: 'blocked',
      reason: 'helperCapture 与 cdpCapture 都是必填 callable。',
      action: '由调用方注入真实 helper 调用与 cdp-proxy /screenshot 调用。',
    };
  }

  let helperError = null;
  try {
    const value = await withTimeout(helperCapture(), helperTimeoutMs, 'helper screenshot');
    if (value) return { status: 'captured', via: 'helper', value };
    helperError = new Error('helper screenshot returned empty value');
  } catch (error) {
    helperError = error;
  }

  let cdpError = null;
  try {
    const value = await cdpCapture();
    if (value) {
      return {
        status: 'captured',
        via: 'cdp-degraded',
        helperError: String(helperError?.message || helperError),
        value,
      };
    }
    cdpError = new Error('CDP screenshot returned empty value');
  } catch (error) {
    cdpError = error;
  }

  return {
    status: 'blocked',
    reason: 'helper 层与 CDP primitive 截图均失败。',
    helperError: String(helperError?.message || helperError),
    cdpError: String(cdpError?.message || cdpError),
    action: '检查 cdp-proxy 连接（/health）与目标 tab 是否仍存在；不得以任何方式伪造视觉 PASS。',
  };
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
