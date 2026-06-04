export type Language = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";
export type ProfileKind = "official" | "custom";

export type OfficialProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "mistral"
  | "xai";

export type ModelEntry = {
  id: string;
  name?: string;
};

export type OfficialProfile = {
  kind: "official";
  id: string;
  name: string;
  providerId: OfficialProviderId;
  apiKey: string;
  models: ModelEntry[];
  defaultModelId: string;
};

export type CustomProfile = {
  kind: "custom";
  id: string;
  name: string;
  providerId: string;
  providerName?: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: ModelEntry[];
  defaultModelId: string;
};

export type Profile = OfficialProfile | CustomProfile;

export type AppConfig = {
  schemaVersion: 1;
  language?: Language;
  theme: ThemeMode;
  activeProfileId?: string;
  profiles: Profile[];
};

export type ResolvedPaths = {
  appConfigFile: string;
  piModelsFile: string;
  piAuthFile: string;
  piSettingsFile: string;
};

export type AppError = {
  code: string;
  message: string;
  details?: string;
  failedFile?: string;
  writtenFiles?: string[];
};

export type TestProfileResult = {
  status: "success" | "failed" | "timeout";
  exitCode?: number;
  stdout: string;
  stderr: string;
};

export const OFFICIAL_PROVIDER_IDS: OfficialProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "groq",
  "mistral",
  "xai",
];

export const OFFICIAL_PROVIDER_LABELS: Record<OfficialProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
};

export const API_PRESETS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export const OFFICIAL_MODEL_PRESETS: Record<OfficialProviderId, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4", "claude-3-5-haiku"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: [],
  groq: [],
  mistral: ["mistral-large-latest", "codestral-latest"],
  xai: ["grok-4", "grok-code-fast"],
};

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: 1,
    theme: "system",
    profiles: [],
  };
}

export function createOfficialProfile(): OfficialProfile {
  return {
    kind: "official",
    id: createProfileId(),
    name: "OpenAI Daily",
    providerId: "openai",
    apiKey: "",
    models: OFFICIAL_MODEL_PRESETS.openai.map((id) => ({ id })),
    defaultModelId: OFFICIAL_MODEL_PRESETS.openai[0],
  };
}

export function createCustomProfile(): CustomProfile {
  return {
    kind: "custom",
    id: createProfileId(),
    name: "Relay Daily",
    providerId: "my-relay",
    providerName: "My Relay",
    baseUrl: "https://relay.example.com/v1",
    api: "openai-completions",
    apiKey: "",
    models: [{ id: "deepseek-chat" }],
    defaultModelId: "deepseek-chat",
  };
}

export function createProfileId() {
  return `profile_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).slice(0, 6)}`;
}

export function sanitizeProviderId(value: string) {
  return value.replace(/\s+/g, "");
}

export function profileProviderId(profile: Profile) {
  return profile.kind === "official" ? profile.providerId : sanitizeProviderId(profile.providerId);
}

export function normalizeConfig(config: AppConfig): AppConfig {
  const activeProfileId =
    config.activeProfileId && config.profiles.some((profile) => profile.id === config.activeProfileId)
      ? config.activeProfileId
      : config.profiles[0]?.id;
  return {
    ...defaultConfig(),
    ...config,
    activeProfileId,
    profiles: config.profiles ?? [],
  };
}

export function validationErrors(profile: Profile | undefined) {
  const errors: Record<string, string> = {};
  if (!profile) {
    errors.form = "NO_PROFILE";
    return errors;
  }
  if (!profile.name.trim()) errors.name = "REQUIRED";
  if (!profile.apiKey.trim()) errors.apiKey = "REQUIRED";
  if (profile.models.length === 0) errors.models = "MODEL_REQUIRED";
  if (!profile.models.some((model) => model.id === profile.defaultModelId)) {
    errors.models = "DEFAULT_MODEL_MISSING";
  }
  if (profile.kind === "custom") {
    const providerId = sanitizeProviderId(profile.providerId);
    if (!providerId) errors.providerId = "REQUIRED";
    if (OFFICIAL_PROVIDER_IDS.includes(providerId as OfficialProviderId)) errors.providerId = "RESERVED";
    if (!profile.baseUrl.trim()) errors.baseUrl = "REQUIRED";
    if (!profile.api) errors.api = "REQUIRED";
  }
  return errors;
}
