# WEBACCESS-02 Artifact — ego 一等浏览器接入

- Repo: `web-access`（主）+ `issue-tracking`（t103648 食谱/记录）
- Branch: `codex/ego-first-class-wa02` · Base: `origin/main@1ac1bf3`
- 来源: `issues/ptc-ai-cities-3/t103654-yiju3-5subdomains-20260820/ego-cdp-capability-exploration.md`（Fable 复核=可行）
- Boundary: 不 merge/deploy；不硬塞 pre-DNS Host 路由进 ego；不修 ego helper 截图超时（ego 侧 bug，只登记）；不动用户真 Chrome。

## Changes（web-access）

1. `browser-discovery.mjs`: darwin `knownBrowsers()` 注册 `ego`（`~/Library/Application Support/Citro Labs/ego lite/DevToolsActivePort`）；`productMatchesBrowser` 接受 ego 自报 `Chrome/` 前缀（实测 Browser.getVersion = `Chrome/150.0.7871.101`，与真 Chrome 无法用 product 区分，身份由 Citro Labs 路径保证）。发现链本来就是「读文件 + TCP 探活 + WS 握手」，ego 的 WS-only 特性（/json/* 全 404）天然兼容。
2. 新模块 `scripts/ua-overrides.mjs`: `mobileUaOverride(product)`（iPhone UA + mobile client hints，brands 从连接的 product 版本派生）与 `clearUaOverride()`（空 UA 恢复默认）。
3. `cdp-proxy.mjs /setViewport`: `mobile:true` 同步下发 `Emulation.setUserAgentOverride`（legacy UA 分流站 SSR 只按 UA 渲染对应设备变体，只改视口不改 UA 会拿错变体）；切回桌面视口自动清除覆盖（状态集 `mobileUaTabs` 跟踪，只对覆盖过的 tab 发清除；tab 关闭/idle sweep/断线处同步清理）；响应新增 `userAgent: mobile|default|unchanged` 字段。
4. 文档: SKILL.md（`--browser <chrome|chromium|edge|ego>` + ego 三点注意: WS-only / product=Chrome/ / 每新 CDP client 一弹授权，缓解=一任务一 proxy 保活；launch-flag 盲区留 CfT）、`references/cdp-api.md`（setViewport UA 行为 + 缓存注意）、README。
5. 测试: +4 用例（ego product 匹配/校验 fail-closed、darwin 路径注册、mobileUaOverride 形状与容错、clearUaOverride）。

## Changes（issue-tracking）

- `issues/copy_immerseact/t103648-adx4638-story-3subdomains/`（issue.md/walls.md/handover.md）首次入库——该 closeout 记录此前一直 untracked（SESSION-PLAN 登记的 RECORDER-01 fixture 之一；本次不改 header/state 数据，数据不一致仍归 RECORDER-01）。
- handover §3.4 食谱更新为 ego-first：`--browser=ego` 免 seed；CfT 食谱降级为 §3.4b，仅留 pre-DNS 多域名 Host 路由场景，并把失效的 `--browser=chromium` 修正为 `--browser=chrome`（CfT 151+ 自报 Chrome/，t103654 W4.1）。

## Acceptance（全部实机执行，2026-08-20；evidence=/tmp/wa02-evidence/）

| 验收项 | 结果 |
|---|---|
| `--browser=ego` 免 seed 直连 | ✅ proxy 日志「选用 ego lite (端口 54602，带 wsPath)」+「已连接浏览器 (端口 54602, Chrome/150.0.7871.101)」，未种任何 DevToolsActivePort |
| legacy 站移动 viewport 拿移动变体 | ✅ green.mewgenics.pro：SSR 判别器 `.site-shell[devicetype]`；桌面 viewport=desktop → setViewport mobile:true → 导航后 devicetype=mobile、navigator.userAgent 含 iPhone、sec-ch-ua-mobile=true；截图 mobile-variant.png 为汉堡菜单窄版布局（vision 复核） |
| UA 覆盖可逆 | ✅ 切回 mobile:false → devicetype=desktop、UA 恢复；二次调用 userAgent:unchanged（无多余 CDP 调用） |
| task-owned tab 生命周期回归 | ✅ SIGTERM →「Shutdown: closed 1 managed tab(s)」，managed tab 消失，用户 10 个既有 tab 逐一未动 |
| 全量测试 | ✅ `node --test test/*.mjs` 16/16 passed（含原 12 条回归） |
| CfT 场景不回退 | ✅ 负例实机：非默认 proxy 无 --browser 仍 blocked；原有 fallback/产品校验用例全绿 |

## 已发现的行为注意（进文档）

- setViewport 覆盖在**下一次导航**生效；且首跳可能命中 HTTP cache 里的旧变体响应（实测：同 URL navigate 仍 desktop，带 query/no-store 才拿 mobile）——recipe 已注明。check-ad-placement-inspector 自身流程是 /new(about:blank)→setViewport→navigate 目标，新 tab 无缓存，天然规避。
- ego 每新建 CDP client 连接弹一次授权（本次实机未弹=复用已授权）；缓解=一任务一 proxy 保活。

## Review / Merge Boundary

- PR candidate: web-access（本分支）+ issue-tracking（`codex/webaccess-02-t103648-recipe`）。owner review/merge only。
- 无 production mutation；本地工具链改动。
