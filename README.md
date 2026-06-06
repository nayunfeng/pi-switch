# Pi Switch

Pi Switch is a Tauri + React + TypeScript desktop configuration console for Pi Coding Agent.

The MVP manages providers for official APIs and custom relay endpoints, then applies one active provider to Pi global configuration.

## Features

- Provider create, duplicate, delete and edit.
- Official providers: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, xAI.
- Custom providers with name, base URL, API type, API key and model list.
- Save GUI config to `~\PiSwitch\config.json`.
- Apply the active provider to:
  - `~\.pi\agent\models.json`
  - `~\.pi\agent\auth.json`
  - `~\.pi\agent\settings.json`
- Preserve OAuth and unknown entries in `auth.json`.
- Preserve unrelated fields in `settings.json`; only update `defaultProvider` and `defaultModel`.
- Fetch OpenAI-compatible `/models` candidates for custom providers.
- Run `pi -p "ping"` with a 15 second timeout.
- Chinese / English UI and system / light / dark theme.

## Development

```bash
npm install
npm run tauri dev
```

On WSLg, WebKitGTK can fail to present the window with Mesa/Zink EGL errors while
the taskbar icon is still visible. Pi Switch automatically enables software GL in
WSL. If you need to run the backend manually, use:

```bash
LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 cargo run --manifest-path src-tauri/Cargo.toml --no-default-features
```

## Validation

```bash
npm run build
cd src-tauri
cargo test
cd ..
npm run tauri build
```

Release bundles are generated under:

```text
src-tauri/target/release/bundle/
```

## Specs

- Product requirements: `docs/specs/pi-switch-prd.md`
- Technical design: `docs/specs/technical-design.md`
- UI flow: `docs/specs/ui-flow.md`
- Wireframes: `docs/specs/wireframes.md`
- Original static prototype: `prototypes/ui/index.html`
