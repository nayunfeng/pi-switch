# Account Contracts

## Scenario: API Key Account Snapshots

### 1. Scope / Trigger

- Trigger: account creation and application crosses React state, Tauri commands, Rust account storage, and Pi `auth.json` / `models.json` writes.
- Applies when changing `AuthAccount`, `create_api_key_account`, `apply_auth_account`, account filtering, or account display.

### 2. Signatures

- Frontend command wrapper: `createApiKeyAccount(providerId: string, label: string, baseUrl: string, apiKey: string)`.
- Tauri command input: `{ providerId: string, label: string, baseUrl: string, apiKey: string }`.
- Frontend account view: `{ id, providerId: string, label, kind, baseUrl?, identity?, createdAt, updatedAt, lastAppliedAt?, activeInPi? }`.
- Stored Rust account includes `base_url?: string` and private `credential`; the frontend view must not include `credential`.

### 3. Contracts

- OAuth accounts require an official provider ID.
- API Key accounts may use an official provider ID or a custom relay/provider key.
- `baseUrl` is a required snapshot for new API Key accounts.
- Built-in and custom providers are creation templates only; saved API Key accounts must keep their own `baseUrl` and credential snapshot.
- Applying an API Key account updates authentication and endpoint state only; it must not update Pi `settings.json`, `defaultProvider`, `defaultModel`, or `enabledModels`.
- Official API Key accounts write credentials through Pi `auth.json` and write endpoint overrides to `models.json` when `baseUrl` is present.
- Custom API Key accounts do not write `auth.json`; they write `baseUrl` and API key into the matching `models.json.providers[providerId]` entry.

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
- Bad: store only a reference to a provider config and read current provider `baseUrl`/`apiKey` when applying the account.

### 6. Tests Required

- Account view serialization exposes `baseUrl` and never exposes `credential`.
- API Key account application preserves existing provider model entries in `models.json`.
- Custom API Key account application writes `models.json` and does not touch `auth.json` or `settings.json`.
- Frontend build must pass after changing account command payloads or account view types.

### 7. Wrong vs Correct

#### Wrong

```typescript
await createApiKeyAccount(provider.providerId, label, apiKey);
```

This loses the endpoint snapshot and cannot support custom relay accounts.

#### Correct

```typescript
await createApiKeyAccount(providerId, label, confirmedBaseUrl, confirmedApiKey);
```

The user-confirmed endpoint and credential are stored on the account, independent of later provider edits.
