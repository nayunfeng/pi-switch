import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, ResolvedPaths, TestProfileResult } from "./domain";

export async function loadAppConfig() {
  return invoke<{ config: AppConfig; resolvedPaths: ResolvedPaths }>("load_app_config");
}

export async function saveAppConfig(config: AppConfig) {
  return invoke<void>("save_app_config", { input: { config } });
}

export async function applyProfileToPi(config: AppConfig, profileId: string) {
  return invoke<void>("apply_profile_to_pi", { input: { config, profileId } });
}

export async function testProfile(config: AppConfig, profileId: string) {
  return invoke<TestProfileResult>("test_profile", { input: { config, profileId } });
}

export async function fetchCustomProviderModels(baseUrl: string, apiKey: string) {
  const result = await invoke<{ models: string[] }>("fetch_custom_provider_models", {
    input: { baseUrl, apiKey },
  });
  return result.models;
}
