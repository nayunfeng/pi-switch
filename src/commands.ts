import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, OfficialProviderId, PiModelInfo, ResolvedPaths, TestProviderResult } from "./domain";

export async function loadAppConfig() {
  return invoke<{ config: AppConfig; resolvedPaths: ResolvedPaths }>("load_app_config");
}

export async function saveAppConfig(config: AppConfig) {
  return invoke<void>("save_app_config", { input: { config } });
}

export async function applyProviderToPi(config: AppConfig, providerEntryId: string) {
  return invoke<void>("apply_provider_to_pi", { input: { config, providerEntryId } });
}

export async function testProvider(config: AppConfig, providerEntryId: string) {
  return invoke<TestProviderResult>("test_provider", { input: { config, providerEntryId } });
}

export async function fetchCustomProviderModels(baseUrl: string, apiKey: string) {
  const result = await invoke<{ models: string[] }>("fetch_custom_provider_models", {
    input: { baseUrl, apiKey },
  });
  return result.models;
}

export async function listPiModels(providerId: OfficialProviderId, apiKey?: string) {
  const result = await invoke<{ models: PiModelInfo[] }>("list_pi_models", {
    input: { providerId, apiKey: apiKey?.trim() || undefined },
  });
  return result.models;
}
