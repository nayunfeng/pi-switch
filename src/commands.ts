import { invoke } from "@tauri-apps/api/core";
import type { AccountsStore, AppConfig, AppError, AuthAccount, OfficialProviderId, PiModelInfo, ResolvedPaths, TestProviderResult } from "./domain";

type TauriInternals = {
  invoke?: typeof invoke;
  transformCallback?: (callback?: unknown, once?: boolean) => number;
};

export function isTauriRuntime() {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return Boolean(internals?.invoke);
}

export function canListenToTauriEvents() {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return Boolean(internals?.invoke && internals.transformCallback);
}

function tauriInvoke<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw {
      code: "TAURI_IPC_UNAVAILABLE",
      message: "Tauri IPC is not available",
      details: "请通过 npm run tauri dev 启动应用，不要直接在普通浏览器中打开 Vite 页面。",
    } satisfies AppError;
  }
  return invoke<T>(command, args);
}

export async function loadAppConfig() {
  return tauriInvoke<{ config: AppConfig; resolvedPaths: ResolvedPaths }>("load_app_config");
}

export async function saveAppConfig(config: AppConfig) {
  return tauriInvoke<void>("save_app_config", { input: { config } });
}

export async function testProvider(config: AppConfig, providerEntryId: string) {
  return tauriInvoke<TestProviderResult>("test_provider", { input: { config, providerEntryId } });
}

export async function fetchCustomProviderModels(baseUrl: string, apiKey: string) {
  const result = await tauriInvoke<{ models: string[] }>("fetch_custom_provider_models", {
    input: { baseUrl, apiKey },
  });
  return result.models;
}

export async function listPiModels(providerId: OfficialProviderId, apiKey?: string) {
  const result = await tauriInvoke<{ models: PiModelInfo[] }>("list_pi_models", {
    input: { providerId, apiKey: apiKey?.trim() || undefined },
  });
  return result.models;
}

export async function loadAuthAccounts() {
  return tauriInvoke<AccountsStore>("load_auth_accounts");
}

export async function submitOAuthManualCode(loginId: string, code: string) {
  return tauriInvoke<void>("submit_oauth_manual_code", {
    input: { loginId, code },
  });
}

export async function cancelOAuthLogin(loginId: string) {
  return tauriInvoke<void>("cancel_oauth_login", {
    input: { loginId },
  });
}

export async function createApiKeyAccount(providerId: string, label: string, baseUrl: string, apiKey: string) {
  return tauriInvoke<AuthAccount>("create_api_key_account", {
    input: { providerId, label, baseUrl, apiKey },
  });
}

export async function renameAuthAccount(accountId: string, label: string) {
  return tauriInvoke<AuthAccount>("rename_auth_account", {
    input: { accountId, label },
  });
}

export async function deleteAuthAccount(accountId: string) {
  return tauriInvoke<void>("delete_auth_account", {
    input: { accountId },
  });
}

export async function duplicateAuthAccount(accountId: string) {
  return tauriInvoke<AuthAccount>("duplicate_auth_account", {
    input: { accountId },
  });
}

export async function applyAuthAccount(accountId: string) {
  return tauriInvoke<AuthAccount>("apply_auth_account", {
    input: { accountId },
  });
}

export async function importPiAuthAccount(providerId: OfficialProviderId, label?: string) {
  return tauriInvoke<AuthAccount>("import_pi_auth_account", {
    input: { providerId, label },
  });
}

export async function loginOfficialProviderOAuth(providerId: OfficialProviderId, label?: string) {
  return tauriInvoke<{ account: AuthAccount; providerName: string }>("login_official_provider_oauth", {
    input: { providerId, label },
  });
}
