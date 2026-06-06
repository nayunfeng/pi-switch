export type Language = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";
export type ProviderKind = "official" | "custom";
export type AuthMode = "existing" | "account" | "apiKey";

export type OfficialProviderId =
  | "amazon-bedrock"
  | "ant-ling"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "nvidia"
  | "deepseek"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "zai-coding-cn"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "moonshotai"
  | "moonshotai-cn"
  | "huggingface"
  | "fireworks"
  | "together"
  | "opencode"
  | "opencode-go"
  | "kimi-coding"
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "xiaomi"
  | "xiaomi-token-plan-cn"
  | "xiaomi-token-plan-ams"
  | "xiaomi-token-plan-sgp";

export type OAuthLoginEvent =
  | { type: "started"; loginId?: string; providerId: OfficialProviderId; providerName?: string; message?: string }
  | { type: "auth"; loginId?: string; providerId: OfficialProviderId; providerName?: string; url: string; instructions?: string }
  | {
      type: "deviceCode";
      loginId?: string;
      providerId: OfficialProviderId;
      providerName?: string;
      verificationUri: string;
      userCode: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "manualCode"; loginId: string; providerId: OfficialProviderId; providerName?: string; message?: string }
  | { type: "prompt"; loginId?: string; providerId: OfficialProviderId; providerName?: string; message: string; placeholder?: string; allowEmpty?: boolean }
  | { type: "select"; loginId?: string; providerId: OfficialProviderId; providerName?: string; message: string; selected?: string; options?: { id: string; label: string }[] }
  | { type: "progress"; loginId?: string; providerId: OfficialProviderId; providerName?: string; message: string }
  | { type: "success"; loginId?: string; providerId: OfficialProviderId; providerName?: string; message?: string };

export type OAuthLoginResult = {
  providerId: OfficialProviderId;
  providerName: string;
};

export type ApiType =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex"
  | (string & {});

export type HeaderEntry = {
  key: string;
  value: string;
};

export type CostConfig = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export type OpenRouterRouting = {
  allowFallbacks?: boolean;
  requireParameters?: boolean;
  dataCollection?: "allow" | "deny" | "";
  zdr?: boolean;
  enforceDistillableText?: boolean;
  order?: string[];
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sortBy?: string;
  sortPartition?: string;
  maxPricePrompt?: number;
  maxPriceCompletion?: number;
  maxPriceImage?: number;
  maxPriceAudio?: number;
  maxPriceRequest?: number;
  minThroughputP50?: number;
  minThroughputP75?: number;
  minThroughputP90?: number;
  minThroughputP99?: number;
  maxLatencyP50?: number;
  maxLatencyP75?: number;
  maxLatencyP90?: number;
  maxLatencyP99?: number;
};

export type VercelGatewayRouting = {
  only?: string[];
  order?: string[];
};

export type CompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens" | "";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "zai" | "qwen" | "qwen-chat-template" | "string-thinking" | "ant-ling" | "";
  zaiToolStream?: boolean;
  supportsStrictMode?: boolean;
  cacheControlFormat?: "anthropic" | "";
  sendSessionAffinityHeaders?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionIdHeader?: boolean;
  supportsEagerToolInputStreaming?: boolean;
  supportsCacheControlOnTools?: boolean;
  supportsTemperature?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  openRouterRouting?: OpenRouterRouting;
  vercelGatewayRouting?: VercelGatewayRouting;
};

export type ModelSource = "builtin" | "custom";

export type ModelConfig = {
  id: string;
  name?: string;
  source?: ModelSource;
  overrideBuiltIn?: boolean;
  api?: ApiType;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: CostConfig;
  headers?: HeaderEntry[];
  compat?: CompatConfig;
  thinkingLevelMap?: ThinkingLevelMap;
};

export type ProviderAdvancedConfig = {
  baseUrl?: string;
  api?: ApiType;
  apiKey?: string;
  headers?: HeaderEntry[];
  authHeader?: boolean;
  compat?: CompatConfig;
};

export type OfficialProvider = {
  kind: "official";
  id: string;
  name: string;
  providerId: OfficialProviderId;
  authMode: AuthMode;
  authAccountId?: string;
  apiKey: string;
  advanced?: ProviderAdvancedConfig;
  models: ModelConfig[];
  defaultModelId: string;
};

export type CustomProvider = {
  kind: "custom";
  id: string;
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  headers?: HeaderEntry[];
  authHeader?: boolean;
  compat?: CompatConfig;
  models: ModelConfig[];
  defaultModelId: string;
};

export type Provider = OfficialProvider | CustomProvider;

export type AppConfig = {
  schemaVersion: 3;
  language?: Language;
  theme: ThemeMode;
  activeProviderId?: string;
  providers: Provider[];
};

export type AuthAccountKind = "oauth" | "apiKey";

export type AuthAccount = {
  id: string;
  providerId: OfficialProviderId;
  label: string;
  kind: AuthAccountKind;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
  activeInPi?: boolean;
};

export type AccountsStore = {
  version: 1;
  accounts: AuthAccount[];
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

export type TestProviderResult = {
  status: "success" | "failed" | "timeout";
  exitCode?: number;
  stdout: string;
  stderr: string;
};

export type PiModelInfo = {
  provider: string;
  id: string;
  context: string;
  maxOut: string;
  thinking: boolean;
  images: boolean;
};

export const OFFICIAL_PROVIDER_IDS: OfficialProviderId[] = [
  "amazon-bedrock",
  "ant-ling",
  "anthropic",
  "google",
  "google-vertex",
  "openai",
  "azure-openai-responses",
  "openai-codex",
  "nvidia",
  "deepseek",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "zai-coding-cn",
  "mistral",
  "minimax",
  "minimax-cn",
  "moonshotai",
  "moonshotai-cn",
  "huggingface",
  "fireworks",
  "together",
  "opencode",
  "opencode-go",
  "kimi-coding",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
];

export const OFFICIAL_PROVIDER_LABELS: Record<OfficialProviderId, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  "ant-ling": "Ant Ling",
  anthropic: "Anthropic",
  google: "Google Gemini",
  "google-vertex": "Google Vertex",
  openai: "OpenAI",
  "azure-openai-responses": "Azure OpenAI Responses",
  "openai-codex": "OpenAI Codex",
  nvidia: "NVIDIA NIM",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  zai: "ZAI",
  "zai-coding-cn": "ZAI Coding China",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax China",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI China",
  huggingface: "Hugging Face",
  fireworks: "Fireworks",
  together: "Together AI",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  "kimi-coding": "Kimi For Coding",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  xiaomi: "Xiaomi MiMo",
  "xiaomi-token-plan-cn": "Xiaomi MiMo Token Plan CN",
  "xiaomi-token-plan-ams": "Xiaomi MiMo Token Plan AMS",
  "xiaomi-token-plan-sgp": "Xiaomi MiMo Token Plan SGP",
};

export const OAUTH_PROVIDER_IDS = ["anthropic", "github-copilot", "openai-codex"] as const satisfies readonly OfficialProviderId[];

export function supportsOAuthLogin(providerId: OfficialProviderId) {
  return (OAUTH_PROVIDER_IDS as readonly OfficialProviderId[]).includes(providerId);
}

export const API_PRESETS: ApiType[] = [
  "openai-completions",
  "mistral-conversations",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-vertex",
];

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: 3,
    theme: "system",
    providers: [],
  };
}

export function createOfficialProvider(): OfficialProvider {
  return {
    kind: "official",
    id: createProviderEntryId(),
    name: "OpenAI",
    providerId: "openai",
    authMode: "existing",
    authAccountId: undefined,
    apiKey: "",
    advanced: {},
    models: [],
    defaultModelId: "",
  };
}

export function createCustomProvider(): CustomProvider {
  return {
    kind: "custom",
    id: createProviderEntryId(),
    name: "Relay",
    baseUrl: "https://relay.example.com/v1",
    api: "",
    apiKey: "",
    headers: [],
    authHeader: true,
    models: [],
    defaultModelId: "",
  };
}

export function createProviderEntryId() {
  return `provider_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).slice(0, 6)}`;
}

export function createModel(id = ""): ModelConfig {
  return {
    id,
    source: "custom",
    input: ["text"],
  };
}

export function sanitizeProviderId(value: string) {
  return value.replace(/\s+/g, "");
}

export function piProviderId(provider: Provider) {
  return provider.kind === "official" ? provider.providerId : sanitizeProviderId(provider.name) || provider.id;
}

export function normalizeConfig(config: AppConfig): AppConfig {
  const providers = (config.providers ?? []).map(normalizeProvider);
  const activeProviderId =
    config.activeProviderId && providers.some((provider) => provider.id === config.activeProviderId)
      ? config.activeProviderId
      : providers[0]?.id;
  return {
    ...defaultConfig(),
    ...config,
    activeProviderId,
    providers,
  };
}

function normalizeProvider(provider: Provider): Provider {
  if (provider.kind === "official") {
    return omitUndefined({
      ...provider,
      authMode: provider.authMode ?? "existing",
      authAccountId: normalizeOptionalString(provider.authAccountId),
      advanced: normalizeProviderAdvanced(provider.advanced),
      models: provider.models.map(normalizeModelConfig),
    });
  }
  return omitUndefined({
    ...provider,
    headers: normalizeOptionalArray(provider.headers),
    authHeader: normalizeOptionalBool(provider.authHeader),
    compat: normalizeOptionalObject(provider.compat),
    models: provider.models.map(normalizeModelConfig),
  });
}

function normalizeProviderAdvanced(advanced: ProviderAdvancedConfig | null | undefined): ProviderAdvancedConfig | undefined {
  if (!advanced) return undefined;
  const normalized = omitUndefined({
    ...advanced,
    baseUrl: normalizeOptionalString(advanced.baseUrl),
    api: normalizeOptionalString(advanced.api),
    apiKey: normalizeOptionalString(advanced.apiKey),
    headers: normalizeOptionalArray(advanced.headers),
    authHeader: normalizeOptionalBool(advanced.authHeader),
    compat: normalizeOptionalObject(advanced.compat),
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeModelConfig(model: ModelConfig): ModelConfig {
  return omitUndefined({
    ...model,
    name: normalizeOptionalString(model.name),
    api: normalizeOptionalString(model.api),
    source: normalizeOptionalString(model.source) as ModelSource | undefined,
    contextWindow: normalizePositiveNumber(model.contextWindow),
    maxTokens: normalizePositiveNumber(model.maxTokens),
    cost: normalizeCost(model.cost),
    headers: normalizeOptionalArray(model.headers),
    compat: normalizeOptionalObject(model.compat),
    thinkingLevelMap: normalizeOptionalObject(model.thinkingLevelMap),
  });
}

function normalizeCost(cost: CostConfig | null | undefined): CostConfig | undefined {
  if (!cost) return undefined;
  const normalized = omitUndefined({
    input: normalizeNonNegativeNumber(cost.input),
    output: normalizeNonNegativeNumber(cost.output),
    cacheRead: normalizeNonNegativeNumber(cost.cacheRead),
    cacheWrite: normalizeNonNegativeNumber(cost.cacheWrite),
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizePositiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : undefined;
  return number !== undefined && Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeNonNegativeNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : undefined;
  return number !== undefined && Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function normalizeOptionalArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : undefined;
}

function normalizeOptionalBool(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeOptionalObject<T extends object>(value: T | null | undefined) {
  return value && typeof value === "object" ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function validationErrors(provider: Provider | undefined) {
  const errors: Record<string, string> = {};
  if (!provider) {
    errors.form = "NO_PROVIDER";
    return errors;
  }
  if (!provider.name.trim()) errors.name = "REQUIRED";
  if (provider.kind === "official" && provider.authMode === "apiKey" && !provider.apiKey.trim()) errors.apiKey = "REQUIRED";
  if (provider.kind === "official" && provider.authMode === "account" && !provider.authAccountId?.trim()) errors.authAccountId = "REQUIRED";
  if (provider.kind === "custom" && !provider.apiKey.trim()) errors.apiKey = "REQUIRED";
  if (enabledModels(provider).length === 0) errors.models = "MODEL_REQUIRED";
  if (!enabledModels(provider).some((model) => model.id === provider.defaultModelId)) {
    errors.models = "DEFAULT_MODEL_MISSING";
  }
  if (hasDuplicateModels(provider.models)) errors.models = "DUPLICATE_MODEL";
  if (provider.models.some((model) => !model.id.trim())) errors.models = "MODEL_ID_REQUIRED";
  if (provider.models.some(hasInvalidNumbers)) errors.models = "INVALID_NUMBER";
  if (provider.models.some(hasInvalidHeaders)) errors.models = "INVALID_HEADER";
  if (provider.kind === "custom") {
    const providerId = piProviderId(provider);
    if (OFFICIAL_PROVIDER_IDS.includes(providerId as OfficialProviderId)) errors.name = "RESERVED";
    if (!provider.baseUrl.trim()) errors.baseUrl = "REQUIRED";
    if (!provider.api) errors.api = "REQUIRED";
    if (hasInvalidHeaders({ headers: provider.headers })) errors.headers = "INVALID_HEADER";
  }
  if (provider.kind === "official" && hasInvalidHeaders({ headers: provider.advanced?.headers })) {
    errors.headers = "INVALID_HEADER";
  }
  return errors;
}

export function enabledModels(provider: Provider) {
  return provider.models;
}

function hasDuplicateModels(models: ModelConfig[]) {
  const ids = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    if (ids.has(id)) return true;
    ids.add(id);
  }
  return false;
}

function hasInvalidNumbers(model: ModelConfig) {
  if (model.contextWindow !== undefined && (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0)) return true;
  if (model.maxTokens !== undefined && (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0)) return true;
  const costs = [model.cost?.input, model.cost?.output, model.cost?.cacheRead, model.cost?.cacheWrite];
  return costs.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0));
}

function hasInvalidHeaders(value: { headers?: HeaderEntry[] }) {
  return (value.headers ?? []).some((header) => !header.key.trim());
}
