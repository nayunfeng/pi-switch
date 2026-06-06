import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, AppError, OfficialProviderId, PiModelInfo, ResolvedPaths, TestProviderResult } from "./domain";

type TauriInternals = {
  invoke?: typeof invoke;
};

function tauriInvoke<T>(command: string, args?: Record<string, unknown>) {
  if (!(window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__?.invoke) {
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

export async function applyProviderToPi(config: AppConfig, providerEntryId: string) {
  return tauriInvoke<void>("apply_provider_to_pi", { input: { config, providerEntryId } });
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
