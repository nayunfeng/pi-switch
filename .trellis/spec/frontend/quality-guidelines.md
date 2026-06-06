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

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
