# S04 / WEBACCESS-01 Artifact

- Repo: `web-access`
- Branch: `codex/cdp-port-safety-s04`
- Base: `origin/main@6418a5a85579f5d6c79ab3ad18ab26f6646f4c03`
- Scope: cdp-proxy fallback port safety and Browser product fail-closed validation.
- Boundary: no merge, deploy, runtime cutover, or user Chrome process changes.

## Changes

1. Non-default proxy instances require explicit `--browser` and never probe fallback port `9222`; candidates are `9229` and `9333`.
2. Browser discovery filters ports already reported by another healthy proxy through `/health` and a `0600` temp registry of live proxy PIDs/ports.
3. The final `Browser.getVersion` handshake validates the requested product; mismatch/unsupported products fail closed with a `疑似用户真 Chrome` diagnostic.
4. `check-deps` validates reused proxy health against expected browser and rejects non-default proxies connected to `9222`.
5. README/SKILL/template document the multi-proxy contract and fallback behavior.

## Acceptance / Negative Tests

- `node --check scripts/browser-discovery.mjs`
- `node --check scripts/cdp-proxy.mjs`
- `node --check scripts/check-deps.mjs`
- `node --test test/*.mjs`
- Result: **12/12 passed**.
- Negative coverage: non-default fallback excludes `9222`; unsupported/product-mismatch CDP products fail closed; another healthy proxy marks its browser port occupied; registry excludes the current proxy's own port but blocks another live proxy; non-default precheck rejects reused `9222` health; existing proxy browser mismatch does not early-pass.
- `git diff --check`: clean.

## Review / Merge Boundary

- PR candidate: https://github.com/CtriXin/web-access/pull/2 (branch `codex/cdp-port-safety-s04`, implementation commits `e6daea9`, `85de4b9`, and `f0d8bc3`, current head `f0d8bc3`), owner review/merge only.
- No production verification applies: this is a local tooling safety change with no deploy or business runtime mutation.
- Wall log: the S04 syntax-test correction is recorded in the audit issue `walls.md`.
