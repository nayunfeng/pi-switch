# Account Contracts

## Scenario: API Key Account Snapshots

### 1. Scope / Trigger

- Trigger: account creation and application crosses React state, Tauri commands, Rust account storage, and Pi `auth.json` / `models.json` writes.
- Applies when changing `AuthAccount`, `create_api_key_account`, `apply_auth_account`, account filtering, account display, or account creation side effects.

### 2. Signatures

- Frontend command wrapper: `createApiKeyAccount(providerId: string, label: string, baseUrl: string, apiKey: string, providerSnapshot?)`.
- Tauri command input: `{ providerId: string, label: string, baseUrl: string, apiKey: string, providerSnapshot?: { name, defaultProvider, defaultModelId, enabledModelIds } }`.
- Frontend account view: `{ id, providerId: string, label, kind, baseUrl?, providerSnapshot?, identity?, createdAt, updatedAt, lastAppliedAt?, activeInPi? }`.
- Stored Rust account includes `base_url?: string` and private `credential`; the frontend view must not include `credential`.

### 3. Contracts

- OAuth accounts require an official provider ID.
- API Key accounts may use an official provider ID or a custom relay/provider key.
- `baseUrl` is a required snapshot for new API Key accounts.
- Built-in and custom providers are creation templates only; saved API Key accounts must keep their own `baseUrl` and credential snapshot.
- When an API Key account is created from an existing provider, it must also keep a safe provider snapshot: `defaultProvider`, `defaultModelId`, and enabled model IDs.
- Creating an API Key account saves the account only. It must not call `applyAuthAccount`, bind a provider, or write Pi `auth.json` / `models.json` / `settings.json` until the user clicks the account row's explicit enable action.
- Applying an account with a provider snapshot updates Pi `settings.json` default fields from that snapshot: `defaultProvider`, `defaultModel`, and `enabledModels`.
- Applying an official account without a provider snapshot still updates Pi `settings.json.defaultProvider` to the account `providerId`. If the backend can match the account to a provider in Pi Switch `config.json`, it also updates `defaultModel` and `enabledModels` from that provider config.
- Applying a custom API Key account without a provider snapshot preserves previous settings behavior and must not infer defaults from the current provider list.
- Account rows should expose an explicit enable action even for the currently active account, because re-enabling rewrites Pi files and syncs refreshed credentials.
- Official API Key accounts write credentials through Pi `auth.json` and write endpoint overrides to `models.json` when `baseUrl` is present.
- Custom API Key accounts do not write `auth.json`; they write `baseUrl` and API key into the matching `models.json.providers[providerId]` entry, and write `settings.json` defaults only when a provider snapshot exists.

### 4. Validation & Error Matrix

- Empty `providerId` -> validation error.
- OAuth account with non-official `providerId` -> validation error.
- Empty API Key `baseUrl` -> validation error.
- Empty API Key credential -> validation error.
- Applying a missing account ID -> validation error.
- Malformed Pi `models.json` or `auth.json` -> file-specific read/write error from the backend command.

### 5. Good/Base/Bad Cases

- Good: create an API Key account from a custom provider, then rename or edit the custom provider; the account still applies the original snapshot.
- Base: create an API Key account from an official provider; default `baseUrl` is prefilled and can be overridden before save.
- Base: create an API Key account and see it in the list without changing current Pi auth until the user clicks enable.
- Base: re-enable an official API Key account with no snapshot after `settings.json.defaultProvider` was manually changed; the backend restores `defaultProvider` from the account and restores `defaultModel` when matching provider config exists.
- Bad: store only a reference to a provider config and read current provider `baseUrl`/`apiKey` when applying the account.
- Bad: call `applyAuthAccount(account.id)` immediately after `createApiKeyAccount(...)` succeeds.
- Bad: skip `settings.json` updates for official accounts just because `providerSnapshot` is missing.

### 6. Tests Required

- Account view serialization exposes `baseUrl` and never exposes `credential`.
- API Key account application preserves existing provider model entries in `models.json`.
- API Key account created from an existing provider applies the provider snapshot to Pi `settings.json`.
- Official API Key account without a provider snapshot applies `settings.json.defaultProvider` from the account and, when provider config is present, `defaultModel` / `enabledModels` from that config.
- Custom API Key account without a provider snapshot writes `models.json` and does not touch `auth.json` or `settings.json`.
- Frontend build must pass after changing account command payloads or account view types.
- Frontend account creation flows must save and refresh the account list without invoking `applyAuthAccount`.

### 7. Wrong vs Correct

#### Wrong

```typescript
await createApiKeyAccount(provider.providerId, label, apiKey);
await applyAuthAccount(account.id);
```

This loses the endpoint snapshot and also applies a newly created account before the user has explicitly enabled it.

#### Correct

```typescript
const account = await createApiKeyAccount(providerId, label, confirmedBaseUrl, confirmedApiKey, providerSnapshot);
await refreshAccounts();
focusAccount(account);
```

The user-confirmed endpoint, credential, and optional provider defaults are stored on the account, independent of later provider edits. Pi files are updated only by the explicit enable action.

## Scenario: OAuth Login Flows (browser / device-code / manual-callback)

### 1. Scope / Trigger

- Trigger: the "Add account" OAuth tab inline state machine in `src/App.tsx`, the `oauth-login-event` listener, and the backend driver `login_official_provider_oauth` → `oauth_login_script` (runs the Pi SDK `auth.login()`).
- OAuth is supported ONLY for `anthropic`, `github-copilot`, `openai-codex`.

### 2. Signatures

- Frontend: `loginOfficialProviderOAuth(providerId, label?)`, `submitOAuthManualCode(loginId, code)`, `cancelOAuthLogin(loginId)`.
- Backend commands: `login_official_provider_oauth`, `submit_oauth_manual_code { loginId, code }`, `cancel_oauth_login { loginId }` (all `#[serde(rename_all = "camelCase")]`).
- Event payload (`OAuthLoginEvent`, channel `oauth-login-event`): every variant carries `loginId`. Variants: `started | auth{url} | deviceCode{userCode, verificationUri, intervalSeconds?, expiresInSeconds?} | manualCode{message} | prompt | select | progress | success`.

### 3. Contracts

- Three real flows (verified against the installed Pi SDK):
  - `openai-codex`, `anthropic` → **browser flow**: emits `auth{url}` AND runs a localhost callback server (codex `1455`, anthropic random port) for auto-capture, AND emits `manualCode` as a fallback.
  - `github-copilot` → **device-code flow**: emits `prompt` (GitHub Enterprise URL; the script auto-answers `""` = github.com) then `deviceCode{userCode, verificationUri}`. It does NOT emit an `auth` url.
- Inline UI MUST branch on event type, in priority order: `auth.url present` → link (full, copyable) + open-in-browser + manual-callback field; else `deviceCode present` → device code + verification page + open-in-browser (NO manual field; the SDK polls to completion); else "generating link".
- Inline mode SUPPRESSES the legacy auto-`openUrl` and the global manual-code popup. The provider-card entry (`loginOAuthProvider`) keeps the legacy auto-open + popup behavior.
- Successful inline OAuth account creation saves the account and refreshes the list only. It must not automatically apply the account to Pi or bind it to the active provider; the user must click enable explicitly.
- Manual callback submit: validate client-side BEFORE `submitOAuthManualCode` — input must be a URL containing `code` and `state`, and `state` must match the auth URL's `state`. Invalid input is NOT submitted (the SDK manual-code call is one-shot; submitting garbage burns the session).
- Cancel: `cancelOAuthLogin(loginId)` kills the node subprocess; backend returns error code `OAUTH_LOGIN_CANCELED`, which the frontend treats silently (not shown as an error). Triggered by close dialog / switch provider / switch to API Key tab / cancel button.

### 4. Validation & Error Matrix

- Unsupported provider id → validation error ("当前官方供应商不支持 OAuth 登录").
- Manual input not a URL / missing `code`|`state` / `state` mismatch → inline error, NOT submitted (session preserved, no restart).
- Submitted-but-rejected code (401 / expired) → `OAUTH_LOGIN_FAILED`; the one-shot session is dead → return to idle (no auto-restart).
- Cancel → `OAUTH_LOGIN_CANCELED` (silent).

### 5. Good/Base/Bad Cases

- Good (codex/anthropic): open link → authorize → localhost server auto-captures → `login` resolves → dialog closes + list refreshed; Pi is unchanged until the user clicks enable.
- Good (github-copilot): show device code → user enters it at the verification page → SDK polls → resolves.
- Bad: an inline UI that only renders `auth.url` makes the device-code provider (github-copilot) hang on "generating link"; submitting unvalidated text burns the one-shot SDK manual-code session.

### 6. Tests Required

- Backend: `cancel_oauth_login` marks the session cancel token and is a no-op for unknown/finished sessions; the session guard cleanup removes both the manual-code file and the cancel registration (`cargo test --lib`).
- Frontend: `tsc --noEmit` + `npm run build` (no frontend test framework). Event-type narrowing (`event.type === "auth" | "deviceCode"`) must precede accessing `url` / `userCode` / `verificationUri`.

### 7. Wrong vs Correct

#### Wrong

```tsx
{oauthAuthUrl ? <Link/> : <Generating/>}     // github-copilot (device-code) never renders → hangs
submitOAuthManualCode(loginId, pastedText);   // unvalidated garbage burns the one-shot session
```

#### Correct

```tsx
{oauthAuthUrl ? <BrowserFlow/> : oauthDeviceCode ? <DeviceCodeFlow/> : <Generating/>}
if (isValidCallback(value)) submitOAuthManualCode(loginId, value); else setInlineError();
```
