// 调试端口探测拦截（反风控）的纯函数部分，供 cdp-proxy 使用并单测。
//
// 背景：cdp-proxy 对每个 attach 的 tab 调 Fetch.enable，只拦截 127.0.0.1/localhost:{chromePort}
// 的请求，并在 Fetch.requestPaused 时以 ConnectionRefused 让请求失败，伪装成调试端口未开放。
//
// flatten 模式（Target.attachToTarget { flatten: true }）下，session 事件的归属写在消息顶层
// msg.sessionId；Fetch.requestPaused 的 params 里没有 sessionId 字段。若从 params 取，
// Fetch.failRequest 会被发到浏览器级连接而失败，被暂停的请求永远不会放行：
// 页面里的探测 fetch 永久 pending、<img>/<script> 探测会卡住 load 事件，/new、/navigate 只能等到超时。

export function portGuardPatterns(chromePort) {
  return [
    { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
    { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
  ];
}

// 输入一条 CDP 消息；是可处理的 Fetch.requestPaused 时返回应发送的 Fetch.failRequest 命令，否则返回 null。
export function pausedRequestFailCommand(msg) {
  if (!msg || msg.method !== 'Fetch.requestPaused') return null;
  const requestId = msg.params?.requestId;
  const sessionId = msg.sessionId;
  if (!requestId || !sessionId) return null;
  return {
    method: 'Fetch.failRequest',
    params: { requestId, errorReason: 'ConnectionRefused' },
    sessionId,
  };
}
