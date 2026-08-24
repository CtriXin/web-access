# S15-PRE-G-B Artifact — ENV-ROUTER-01 web-access 路由边界（重派 v2）

- Repo: `CtriXin/web-access`（单仓；不碰 scmp-ops=G-a、不碰 preview cache/occupancy=F-c、未装/升级任何浏览器）
- Branch: `codex/pre-g-env-router-v2` · Base: `origin/main@004469f`（含 web-access#3）
- 卡定义: `TASK-DISPATCH.md`「S15-PRE-G-b 重派 v2」（唯一 scope；未做 addendum §8 的 G-a 探测项）
- Boundary: 不 merge（归 Fable）；无 production mutation；不动用户真 Chrome / 用户默认 proxy（3456）
- Evidence: `/tmp/s15-pre-g-b-evidence/`（readback、fixture 输出、proxy 日志、ps 证明、final-tests.log）

## Changes（单意图：ego/CfT 路由边界代码化 + 其实测通路）

1. **`scripts/env-router.mjs`（新）** — ego/CfT 永久分工的确定性路由：
   - `routeBrowser({ intent, requiresHostResolverRules, forced })`：`production`/`visual`/`behavior` → ego lane（附着、headful=false）；`pre-dns-host-mapping` 或任何需要 `--host-resolver-rules` 的任务 → CfT lane（独立 headful、task-owned profile、调试端口 9229/9333）。
   - 负例（actionable blocked，绝不静默换道）：forced=ego 跑 pre-DNS（ego 运行实例补不了 launch flag，硬边界）；forced=cft 跑 production（无登录态，方向相反）；未知 intent / 未知 forced lane。
   - `captureVisualEvidence({ helperCapture, cdpCapture, helperTimeoutMs })`：helper 层截图失败/超时 → 自动降级 CDP primitive；两层都失败 → 明确 `blocked`（含双边错误与处置指引），**不伪造视觉 PASS**。
2. **`scripts/cft-host-browser.mjs`（新）** — task-owned headful CfT 启动器（本 repo 唯一 sanctioned headful 场景）：`start/status/stop`；binary 发现 = `CFT_BINARY` → puppeteer/agent-browser 缓存根取最新版（无候选 fail closed，不回退用户真 Chrome）；launch 记录写 `<profile>/cft-launch.json`；`stop` 先核对 pid cmdline 确属本 profile 才 SIGTERM——只杀自己起的进程。
3. **`scripts/browser-discovery.mjs`** — 修 fallback 附着现代 Chrome/CfT 的真实断点：`findFallbackPort` 现在从 `http://127.0.0.1:<port>/json/version` 提取 `webSocketDebuggerUrl` 的 UUID 路径（现代 Chrome 拒绝裸 `ws://.../devtools/browser`，F3 实测连接失败）；拿不到 → `wsPath=null` 由连接层硬错，不假装可用。
4. **测试 +21**：`test/env-router.test.mjs`（15：路由正/负例、降级三态、lane 形状）、`test/cft-host-browser.test.mjs`（8：binary 发现、ownsProcess 安全闸、launch 记录）、`test/browser-discovery.test.mjs`（+2：fallbackWsPath 提取与 fail-closed）。
5. **`SKILL.md`** — 新增「环境路由：ego / CfT 永久分工」一节（分工表、铁律、CfT lane 用法、截图降级纪律、ego helper 超时 bug 登记）。

## Active readback（实测记录 = `readback-three-cli.txt`，2026-08-24T01:53Z）

| CLI | registration | 解析目标 |
|---|---|---|
| `~/.agents/skills/web-access` | symlink | `/Users/xin/auto-skills/CtriXin-repo/web-access` |
| `~/.codex/skills/web-access` | symlink | 同上 |
| `~/.claude/skills/web-access` | symlink | 同上 |

三套 CLI 解析到**同一 authority**。开工时该 checkout 在 `main@1ac1bf3`（缺 #3，同类 OI-11 landing 漂移）；本任务先做 landing ff（clean 工作树，`git pull --ff-only` 1ac1bf3→004469f），readback 结果：HEAD=`004469f5a751…`，`merge-base --is-ancestor 004469f HEAD` = yes（含 #3），`git status` clean。

## 四 fixture 实证（一次性命令+输出；evidence 目录含全文）

| # | fixture | 结果 | 关键输出 |
|---|---|---|---|
| F1 | ego production attach（真实站） | ✅ | proxy 日志「选用 ego lite (端口 54602，带 wsPath) [--browser 指定]」「已连接浏览器 (端口 54602, Chrome/150.0.7871.101)」；green.mewgenics.pro 加载 complete，title=「Green Metro \| Global Livable City Rankings…」 |
| F2 | ego mobile viewport → legacy SSR 移动变体 | ✅ | green.mewgenics.pro：桌面基线 `devicetype=desktop` → `setViewport 390×844 mobile:true`（响应 `userAgent:"mobile"`）→ cache-busted 导航后 `devicetype=mobile`、UA=iPhone、`userAgentData.mobile=true` |
| F3 | CfT pre-DNS Host 路由一例 | ✅ | `cft-host-browser.mjs start --host-resolver-rules "MAP pre-dns-fixture.test 127.0.0.1" --port 9229`（headful，本 lane 唯一允许）→ 非默认 proxy（3463, `--browser=chrome`）fallback 命中 9229（新 wsPath 修复生效，product=Chrome/148.0.7778.97）→ `http://pre-dns-fixture.test:8901/` 返回 marker `pre-dns-fixture-ok host=pre-dns-fixture.test:8901`（Host 头证明 pre-DNS 名字解析，该域名无 DNS 记录） |
| F4 | screenshot helper 超时 → CDP 降级 | ✅ | `captureVisualEvidence` 实跑：ego helper `captureScreenshot` 45s 超时（**ego 侧 bug 复发实证，只登记不修**）→ 自动降级 CDP `Page.captureScreenshot` → 真 PNG 214,360 bytes（390×844，与移动视口一致）；via=`cdp-degraded`，无伪造 PASS |

## Task-owned 生命周期回归

- 全程未导航用户任何已登录 tab；无 global kill（只对自己的 pid 单发 SIGTERM）。
- ego lane：BEFORE 快照 7 page targets（6 用户 tab + 1 本任务 tab）→ 关 proxy 日志「Shutdown: closed 1 managed tab(s)」→ FINAL 快照 6 targets = BEFORE 的 6 个用户 tab 逐一在位（`ego-tabs-before.txt` / `ego-tabs-after.txt` 对拍）。
- F4 的 ego task space（`s15-pre-g-b-f4`）已关闭（关最后一个 tab = 关 space，`listTaskSpaces` 复核为空）；其 newtab 残留已清。
- CfT lane：tab close → proxy SIGTERM → `cft-host-browser stop --clean`（kill 前 cmdline 核对）→ profile 目录删除。
- 全量测试：**43/43 pass**（`final-tests.log`）。

## 继承遗留处置（首次派发作废会话的泄漏进程，非本任务产生）

作废的首次派发（`issue-tracking-worktrees/pre-g-env-router-web-access`）泄漏了两个进程，均用**单 pid SIGTERM** 关闭并核对 cmdline 归属：

1. CfT headful 实例 pid 78916（tmp profile `web-access-cft-dHojzJ`，9333，8-21 起挂着）——它同时是 check-deps 测试套件在干净 main 上也失败的根因（fallback 候选撞到 9333），关闭后套件恢复全绿。
2. cdp-proxy pid 31902（3457，`--browser ego`，0 session 0 managedTab）——占住 ego 的 54602 使任何新 proxy 无法附着 ego。

## 零遗留进程证明（`ps-zero-leftover.txt`，2026-08-24T02:08Z）

- 本任务 proxy 端口 3462/3463：无监听；`pre-g-env-router-v2` cdp-proxy 进程：无。
- 本任务 CfT（`gb-cft-profile`）：无进程、profile 已删；9229/9333 无监听；`web-access-cft` 残留：无。
- marker HTTP server（8901）：已关。
- 用户默认 proxy（3456，连用户真 Chrome，**非本任务所有**）：原样保留未动。

## 已登记不修

- ego helper `captureScreenshot` 超时 = ego 侧 bug（F4 复发实证；CDP 层 0.x s 正常）。归 ego vendor，不进本 repo。
- check-deps 套件对环境中的 stray 调试浏览器敏感（fallback 候选会撞车）——本次两例失败均为泄漏进程造成，非代码回归；是否加隔离归后续卡。

## Review / Merge Boundary

- PR candidate: `CtriXin/web-access` branch `codex/pre-g-env-router-v2`（单意图）。merge 归 Fable。
- 落地后如需 pin/registration 更新（web-access 非 manifest pinned 组件，三 CLI 直连 source checkout）：merge 后 source checkout 再做一次 landing ff 即到达 active。
