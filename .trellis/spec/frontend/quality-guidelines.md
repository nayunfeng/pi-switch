# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

### Scenario: Browser Preview Tauri Event Guard

#### 1. Scope / Trigger

- Trigger: frontend code in `src/App.tsx` or related UI modules that calls Tauri event APIs such as `listen(...)`.
- Symptom in ordinary Vite/browser preview: `Cannot read properties of undefined (reading 'transformCallback')`.

#### 2. Signatures

- Runtime capability helpers: `isTauriRuntime()` and `canListenToTauriEvents()` in `src/commands.ts`.
- Event registration: `listen<OAuthLoginEvent>("oauth-login-event", handler)` in `src/App.tsx`.

#### 3. Contracts

- Tauri command calls may require `window.__TAURI_INTERNALS__.invoke`.
- Tauri event listeners also require `window.__TAURI_INTERNALS__.transformCallback`.
- Any code path that registers `listen(...)` must guard with `canListenToTauriEvents()` before calling `listen`.
- Browser-preview URL opening should fall back to `window.open` when Tauri opener is unavailable.

#### 4. Validation & Error Matrix

- Browser preview with no `__TAURI_INTERNALS__` -> skip event registration; no `transformCallback` error.
- Tauri runtime with `invoke` and `transformCallback` -> event registration works.
- Browser preview opening an OAuth URL -> use `window.open`.
- Tauri runtime opening an OAuth URL -> use `openUrl`.

#### 5. Good/Base/Bad Cases

- Good: ordinary browser refresh renders the app shell and surfaces normal IPC-unavailable toast messages without crashing.
- Base: Tauri desktop startup still receives OAuth login events.
- Bad: calling `listen(...)` unconditionally during React mount.

#### 6. Tests Required

- Run `npm run build`.
- For related account/auth UI changes, run `npm run test:auth`.
- If touching event registration again, inspect ordinary browser refresh for absence of `transformCallback` console errors.

#### 7. Wrong vs Correct

##### Wrong

```typescript
listen("oauth-login-event", handler);
```

##### Correct

```typescript
if (canListenToTauriEvents()) {
  listen("oauth-login-event", handler);
}
```

---

### Scenario: WSLg WebKitGTK Window Presentation Fallback

#### 1. Scope / Trigger

- Trigger: Tauri/WebKitGTK starts on WSLg but the window is not presented; only the taskbar icon appears.
- Symptom: terminal logs include Mesa/Zink EGL failures such as `MESA: error: ZINK: failed to choose pdev` or `egl: failed to create dri2 screen`.

#### 2. Signatures

- Rust startup entrypoint: `pub fn run()` in `src-tauri/src/lib.rs`.
- Linux helper: `configure_linux_webview_environment()`.

#### 3. Contracts

- WSL detection must use `WSL_DISTRO_NAME`, `WSL_INTEROP`, or `/proc/version` containing `microsoft`/`wsl`.
- In WSL only, set these environment keys before constructing `tauri::Builder`:
  - `LIBGL_ALWAYS_SOFTWARE=1`
  - `WEBKIT_DISABLE_DMABUF_RENDERER=1`
- Use set-if-unset behavior. Do not overwrite explicit user-provided environment values.
- Do not apply this fallback to non-WSL Linux desktops by default.

#### 4. Validation & Error Matrix

- WSL detected and vars unset -> both vars are set before WebKitGTK initializes.
- WSL detected and vars already set -> existing values are preserved.
- Non-WSL Linux -> no fallback vars are added by the app.
- Missing or unreadable `/proc/version` -> treat as non-WSL unless WSL env vars exist.

#### 5. Good/Base/Bad Cases

- Good: `npm run tauri dev` in WSLg opens the app without Mesa/Zink EGL presentation errors.
- Base: Normal Linux users keep their existing hardware rendering path.
- Bad: Setting `LIBGL_ALWAYS_SOFTWARE=1` globally for every Linux desktop can degrade rendering unnecessarily.

#### 6. Tests Required

- Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- Run `npm run build` for UI/type safety.
- On WSLg, short-run the backend with `timeout 8s cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color never --` and assert the EGL/Zink failure logs do not appear.

#### 7. Wrong vs Correct

##### Wrong

```rust
std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
```

##### Correct

```rust
if is_wsl_environment() {
    set_env_if_unset("LIBGL_ALWAYS_SOFTWARE", "1");
    set_env_if_unset("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}
```

---

### Scenario: Windows Pi Command/Package Discovery

#### 1. Scope / Trigger

- Trigger: backend code in `src-tauri/src/lib.rs` that locates the `pi` CLI, spawns it, or loads the Pi node package (`dist/index.js`). Used by `list_pi_models_*` and `login_official_provider_oauth`.
- Cross-platform infra contract: Unix and Windows resolve/launch `pi` and the package path differently. Symptom on Windows when violated: "无法读取 Pi 模型" and OAuth never starts (`which`/`pi.cmd`/`\\?\`/`file://` failures), or node `ERR_INVALID_FILE_URL_PATH`.

#### 2. Signatures

- `find_pi_command_path() -> AppResult<PathBuf>` — locate the `pi` launcher.
- `select_pi_command_path(locator_stdout: &str) -> Option<String>` — pure: pick a spawnable launcher from multi-line locator output.
- `resolve_pi_package_index(pi_path: &Path) -> AppResult<PathBuf>` — shared helper returning `<pkg>/dist/index.js` (used by registry + OAuth).
- `strip_extended_length_prefix(path: &Path) -> PathBuf` — pure: drop Windows `\\?\` / `\\?\UNC\`.

#### 3. Contracts

- Locator: `#[cfg(windows)]` uses `where`; `#[cfg(not(windows))]` uses `which`. `where` may return multiple lines (`pi`, `pi.cmd`, `pi.ps1`) → `select_pi_command_path` prefers a Rust-`Command`-spawnable launcher (`.cmd`/`.bat`/`.exe`) over the extension-less bash shim.
- CLI spawn: Windows must invoke the shim via `cmd /C <pi.cmd> --list-models <provider> --offline` (Rust `Command::new("pi")` cannot start a `.cmd`/`.ps1`; there is no `pi.exe`). Unix spawns `pi` directly.
- Canonicalization: `fs::canonicalize` on Windows yields a `\\?\`-prefixed path → MUST pass through `strip_extended_length_prefix` before deriving paths or building URLs.
- Package path: Unix derives `pi_path.parent().parent()/dist/index.js` (npm symlink layout); Windows parses the `pi.cmd`/`pi` shim's embedded `node_modules/.../dist/cli.js`, swaps `cli.js`→`index.js`, with an npm-global-prefix fallback.
- Node dynamic import URL: NEVER `format!("file://{}", path.display())`. Pass the raw OS path (JSON-serialized) into the node script and use `pathToFileURL(path).href`.

#### 4. Validation & Error Matrix

- `where`/`which` not found or empty stdout → `PI_COMMAND_NOT_FOUND`.
- shim parse fails AND npm-prefix fallback has no `dist/index.js` → `PI_PACKAGE_NOT_FOUND`.
- `pi --list-models` non-zero exit → `PI_MODEL_LIST_FAILED`; CLI failure falls back to the registry (node) path; both failing → `PI_MODEL_REGISTRY_FAILED`.

#### 5. Good/Base/Bad Cases

- Good (Windows): `where pi` → picks `...\npm\pi.cmd`; package resolves to `...\node_modules\@earendil-works\pi-coding-agent\dist\index.js`; node imports via `pathToFileURL`.
- Base (Unix/macOS): `which pi` → symlink canonicalizes into the package; `parent().parent()/dist/index.js`.
- Bad: `Command::new("pi")` on Windows; `which` on Windows (absent); `file://` + `\\?\C:\...` → `ERR_INVALID_FILE_URL_PATH`.

#### 6. Tests Required

- `select_pi_command_*`: prefers `.cmd` over extension-less shim; falls back to first candidate (Unix single line) / empty input → None.
- `pi_dist_index_from_*`: extracts `dist/cli.js` from cmd & bash shims (both slash styles, strips `%dp0%`/`$basedir`), swaps to `index.js`; returns None without a cli token.
- `strip_extended_length_prefix_*`: `\\?\C:\...`→`C:\...`, `\\?\UNC\server\share`→`\\server\share`, Unix/plain → no-op.
- Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` + `cargo build`.

#### 7. Wrong vs Correct

##### Wrong

```rust
let out = Command::new("pi").arg("--list-models").output().await?;                 // Windows: can't start pi.cmd
let pkg = canonicalized_pi.parent().unwrap().parent().unwrap().join("dist/index.js"); // Windows: wrong layout + \\?\
let url = format!("file://{}", pkg.display());                                     // Windows: invalid file URL
```

##### Correct

```rust
let pi = find_pi_command_path().await?;     // where on Windows / which on Unix, picks a spawnable launcher
let index = resolve_pi_package_index(&pi)?; // strips \\?\, parses shim on Windows / symlink layout on Unix
// node script: import { pathToFileURL } from "node:url"; await import(pathToFileURL(<index>).href)
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
