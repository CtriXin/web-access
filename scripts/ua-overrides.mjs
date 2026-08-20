// UA override 辅助 - setViewport mobile:true 时同步覆盖 User-Agent。
//
// 背景（t103654 ego-cdp 探索）：legacy 配置的广告站 SSR 按 UA 分流，只渲染对应设备变体。
// Emulation.setDeviceMetricsOverride 只改视口尺寸不改 UA —— 移动 viewport + 桌面 UA
// 会在 legacy 站拿到桌面变体（实测 4/5 placement-not-visible），移动验收失真。
// 因此 /setViewport mobile:true 必须同时下发移动 UA；切回桌面视口时清除覆盖恢复默认。

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// product 形如 "Chrome/150.0.7871.101"（Browser.getVersion 返回值），用于派生一致的 client hints。
export function mobileUaOverride(product) {
  const version = String(product || '').includes('/')
    ? String(product).split('/')[1]
    : '';
  const major = version.split('.')[0] || '';
  return {
    userAgent: MOBILE_USER_AGENT,
    acceptLanguage: 'en-us',
    platform: 'iPhone',
    userAgentMetadata: {
      brands: major ? [{ brand: 'Chromium', version: major }] : [],
      fullVersionList: version ? [{ brand: 'Chromium', version }] : [],
      platform: 'iOS',
      platformVersion: '',
      architecture: '',
      model: 'iPhone',
      mobile: true,
      bitness: '',
      uaFullVersion: version,
    },
  };
}

// 清除 UA 覆盖：CDP 约定空 userAgent 恢复浏览器默认 UA。
export function clearUaOverride() {
  return { userAgent: '' };
}
