import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  Check,
  CirclePlay,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Moon,
  MoreVertical,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Settings2,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  applyAuthAccount,
  createApiKeyAccount,
  deleteAuthAccount,
  duplicateAuthAccount,
  fetchCustomProviderModels,
  loginOfficialProviderOAuth,
  loadAuthAccounts,
  listPiModels,
  loadAppConfig,
  renameAuthAccount,
  saveAppConfig,
  submitOAuthManualCode,
  cancelOAuthLogin,
  testProvider as runTestProvider,
} from "./commands";
import {
  API_PRESETS,
  AppConfig,
  AppError,
  AuthAccount,
  AuthMode,
  CompatConfig,
  createCustomProvider,
  createModel,
  createOfficialProvider,
  enabledModels,
  HeaderEntry,
  ModelConfig,
  normalizeConfig,
  OFFICIAL_PROVIDER_IDS,
  OFFICIAL_PROVIDER_LABELS,
  OfficialProviderId,
  OAuthLoginEvent,
  piProviderId,
  PiModelInfo,
  Provider,
  ResolvedPaths,
  supportsOAuthLogin,
  ThemeMode,
  ThinkingLevel,
  validationErrors,
} from "./domain";
import { createTranslator, systemLanguage } from "./i18n";
import { Select } from "./Select";

type TestState = {
  status: "idle" | "running" | "success" | "failed" | "timeout";
  output: string;
};

type ToastState = {
  kind: "success" | "error" | "info";
  message: string;
};

type OAuthState = {
  providerId?: OfficialProviderId;
  running: boolean;
  events: OAuthLoginEvent[];
};

type MainTab = "providers" | "accounts";
type AccountProviderFilter = "all" | string;
type AddAccountMode = "oauth" | "apiKey";
type ApiKeyProviderSource = "official" | "custom";
type ProviderValidationState = Record<string, { attempted?: boolean; touched?: Record<string, boolean> }>;

type ModelDraft = {
  model: ModelConfig;
  index?: number;
};

const EMPTY_MODEL_DRAFT: ModelDraft = { model: createModel() };
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const OFFICIAL_PROVIDER_BASE_URLS: Partial<Record<OfficialProviderId, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  "openai-codex": "https://api.openai.com/v1",
  "azure-openai-responses": "https://{resource}.openai.azure.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  "github-copilot": "https://api.githubcopilot.com",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  "vercel-ai-gateway": "https://ai-gateway.vercel.sh/v1",
  mistral: "https://api.mistral.ai/v1",
  minimax: "https://api.minimax.io/v1",
  "minimax-cn": "https://api.minimax.chat/v1",
  moonshotai: "https://api.moonshot.ai/v1",
  "moonshotai-cn": "https://api.moonshot.cn/v1",
  huggingface: "https://router.huggingface.co/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  together: "https://api.together.xyz/v1",
  "cloudflare-ai-gateway": "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}",
};

function createEmptyCustomProviderDraft(): Extract<Provider, { kind: "custom" }> {
  return { ...createCustomProvider(), name: "", baseUrl: "" };
}

function createEmptyOfficialProviderDraft(): Extract<Provider, { kind: "official" }> {
  return { ...createOfficialProvider(), name: "", authMode: "apiKey", authAccountId: undefined };
}

function App() {
  const [config, setConfig] = useState<AppConfig>(() => normalizeConfig({ schemaVersion: 3, theme: "system", providers: [] }));
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("accounts");
  const [selectedAccountId, setSelectedAccountId] = useState<string>();
  const [accountProviderFilter, setAccountProviderFilter] = useState<AccountProviderFilter>("all");
  const [newOAuthProviderId, setNewOAuthProviderId] = useState<OfficialProviderId>("openai-codex");
  const [newAccountProviderId, setNewAccountProviderId] = useState<string>("openai-codex");
  const [newAccountMode, setNewAccountMode] = useState<AddAccountMode>("oauth");
  const [newApiKeyProviderSource, setNewApiKeyProviderSource] = useState<ApiKeyProviderSource>("official");
  const [newApiKeyOfficialProviderId, setNewApiKeyOfficialProviderId] = useState<OfficialProviderId>("openai-codex");
  const [newApiKeyCustomProviderId, setNewApiKeyCustomProviderId] = useState("");
  const [newAccountBaseUrl, setNewAccountBaseUrl] = useState(officialProviderBaseUrl("openai-codex"));
  const [newAccountApiKey, setNewAccountApiKey] = useState("");
  const [showAccountKey, setShowAccountKey] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [paths, setPaths] = useState<ResolvedPaths>();
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState<ToastState>();
  const [testState, setTestState] = useState<TestState>({ status: "idle", output: "" });
  const [candidateModels, setCandidateModels] = useState<string[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [fetching, setFetching] = useState(false);
  const [piModels, setPiModels] = useState<PiModelInfo[]>([]);
  const [piModelsLoading, setPiModelsLoading] = useState(false);
  const [oauthState, setOAuthState] = useState<OAuthState>({ running: false, events: [] });
  const [piModelSearch, setPiModelSearch] = useState("");
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL_DRAFT);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const modelDialogRef = useRef<HTMLDialogElement>(null);
  const providerAdvancedDialogRef = useRef<HTMLDialogElement>(null);
  const outputDialogRef = useRef<HTMLDialogElement>(null);
  const addAccountDialogRef = useRef<HTMLDialogElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const deleteAccountDialogRef = useRef<HTMLDialogElement>(null);
  const oauthManualCodeDialogRef = useRef<HTMLDialogElement>(null);
  const [renameTarget, setRenameTarget] = useState<AuthAccount>();
  const [renameLabel, setRenameLabel] = useState("");
  const [deleteAccountTarget, setDeleteAccountTarget] = useState<AuthAccount>();
  const [oauthManualCodeState, setOAuthManualCodeState] = useState<{ loginId: string; message: string }>();
  const [oauthManualCodeInput, setOAuthManualCodeInput] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<Provider>();
  const [providerValidation, setProviderValidation] = useState<ProviderValidationState>({});
  const openedOAuthUrlsRef = useRef<Set<string>>(new Set());
  const oauthInlineActiveRef = useRef(false);
  const oauthInlineLoginIdRef = useRef<string | undefined>(undefined);
  const oauthRunningRef = useRef(false);
  const oauthCallbackSubmittedRef = useRef(false);
  const [oauthCallbackInput, setOAuthCallbackInput] = useState("");
  const [oauthCallbackError, setOAuthCallbackError] = useState("");
  const openedEmptyAccountsRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const language = config.language ?? systemLanguage();
  const t = useMemo(() => createTranslator(language), [language]);
  const persistedActiveProvider = config.providers.find((provider) => provider.id === config.activeProviderId);
  const activeProvider = providerDraft ?? persistedActiveProvider;
  const filteredAccounts = useMemo(
    () =>
      (accountProviderFilter === "all" ? accounts : accounts.filter((account) => account.providerId === accountProviderFilter))
        .slice()
        .sort(compareAccountsForDisplay),
    [accounts, accountProviderFilter],
  );
  const customProviderOptions = useMemo(() => config.providers.filter((provider): provider is Extract<Provider, { kind: "custom" }> => provider.kind === "custom"), [config.providers]);
  const selectedAccount = filteredAccounts.find((account) => account.id === selectedAccountId) ?? filteredAccounts[0];
  const errors = visibleProviderErrors(activeProvider, providerValidation);

  useEffect(() => {
    loadAppConfig()
      .then((result) => {
        setConfig(normalizeConfig(result.config));
        setPaths(result.resolvedPaths);
      })
      .catch((err) => showError(err))
      .finally(() => setLoading(false));
    refreshAccounts().catch((err) => showError(err));
  }, []);

  useEffect(() => {
    if (!selectedAccountId && filteredAccounts.length > 0) {
      setSelectedAccountId(filteredAccounts[0].id);
      return;
    }
    if (selectedAccountId && filteredAccounts.length > 0 && !filteredAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(filteredAccounts[0].id);
    }
    if (filteredAccounts.length === 0) {
      setSelectedAccountId(undefined);
    }
  }, [filteredAccounts, selectedAccountId]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<OAuthLoginEvent>("oauth-login-event", (event) => {
      if (!mounted) return;
      const inline = oauthInlineActiveRef.current;
      if (inline) {
        if (event.payload.loginId) {
          oauthInlineLoginIdRef.current = event.payload.loginId;
        }
      } else {
        const urlToOpen = event.payload.type === "auth" ? event.payload.url : event.payload.type === "deviceCode" ? event.payload.verificationUri : undefined;
        if (urlToOpen && !openedOAuthUrlsRef.current.has(urlToOpen)) {
          openedOAuthUrlsRef.current.add(urlToOpen);
          openUrl(urlToOpen).catch((err) => showError(err));
        }
        if (event.payload.type === "manualCode") {
          setOAuthManualCodeInput("");
          setOAuthManualCodeState({ loginId: event.payload.loginId, message: event.payload.message ?? t("oauthManualCodePrompt") });
          oauthManualCodeDialogRef.current?.showModal();
        }
      }
      setOAuthState((state) => ({
        ...state,
        providerId: event.payload.providerId,
        events: [...state.events, event.payload].slice(-8),
      }));
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((err) => showError(err));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [t]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), toastDuration(toast.kind));
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (newApiKeyProviderSource === "official") {
      setNewAccountProviderId(newApiKeyOfficialProviderId);
      setNewAccountBaseUrl(officialProviderBaseUrl(newApiKeyOfficialProviderId));
      setNewAccountApiKey("");
      return;
    }
    const selectedCustomProvider = customProviderOptions.find((provider) => provider.id === newApiKeyCustomProviderId) ?? customProviderOptions[0];
    if (!selectedCustomProvider) {
      setNewApiKeyCustomProviderId("");
      setNewAccountProviderId("");
      setNewAccountBaseUrl("");
      setNewAccountApiKey("");
      return;
    }
    if (selectedCustomProvider.id !== newApiKeyCustomProviderId) {
      setNewApiKeyCustomProviderId(selectedCustomProvider.id);
    }
    setNewAccountProviderId(piProviderId(selectedCustomProvider));
    setNewAccountBaseUrl(selectedCustomProvider.baseUrl);
    setNewAccountApiKey(selectedCustomProvider.apiKey);
  }, [customProviderOptions, newApiKeyCustomProviderId, newApiKeyOfficialProviderId, newApiKeyProviderSource]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t("title");
  }, [language, t]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = config.theme === "dark" || (config.theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [config.theme]);

  useEffect(() => {
    if (!providerDrawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        closeProviderDrawer();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [providerDrawerOpen]);

  function updateConfig(next: AppConfig) {
    setConfig(normalizeConfig(next));
  }

  function showToast(kind: ToastState["kind"], message: string) {
    setToast({ kind, message });
  }

  function showError(err: unknown) {
    showToast("error", formatError(err, t));
  }

  async function refreshAccounts() {
    const store = await loadAuthAccounts();
    setAccounts(store.accounts);
    if (store.accounts.length === 0 && !openedEmptyAccountsRef.current) {
      openedEmptyAccountsRef.current = true;
      setActiveTab("accounts");
      setAccountProviderFilter("openai-codex");
      setNewOAuthProviderId("openai-codex");
      setNewApiKeyOfficialProviderId("openai-codex");
    }
  }

  async function refreshAccountState() {
    setAccountBusy(true);
    try {
      await refreshAccounts();
      showToast("success", t("accountsRefreshed"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  function updateActiveProvider(provider: Provider) {
    if (providerDraft?.id === provider.id) {
      setProviderDraft(provider);
      return;
    }
    updateConfig({
      ...config,
      providers: config.providers.map((item) => (item.id === provider.id ? provider : item)),
    });
  }

  function markProviderField(providerId: string, field: string) {
    setProviderValidation((state) => ({
      ...state,
      [providerId]: {
        ...state[providerId],
        touched: {
          ...state[providerId]?.touched,
          [field]: true,
        },
      },
    }));
  }

  function markProviderAttempted(providerId: string) {
    setProviderValidation((state) => ({
      ...state,
      [providerId]: {
        ...state[providerId],
        attempted: true,
      },
    }));
  }

  function updateActiveProviderField(provider: Provider, field: string) {
    markProviderField(provider.id, field);
    updateActiveProvider(provider);
  }

  function selectProvider(providerId: string) {
    setProviderDraft(undefined);
    updateConfig({ ...config, activeProviderId: providerId });
    setShowKey(false);
    setProviderDrawerOpen(true);
  }

  function closeProviderDrawer() {
    setProviderDrawerOpen(false);
    setProviderDraft(undefined);
  }

  function manageAccountsForProvider(providerId: OfficialProviderId) {
    setNewOAuthProviderId(providerId);
    setNewApiKeyOfficialProviderId(providerId);
    setAccountProviderFilter(providerId);
    closeProviderDrawer();
    setActiveTab("accounts");
  }

  function focusAccount(account: AuthAccount) {
    setAccountProviderFilter(account.providerId);
    if (isOfficialProviderId(account.providerId)) {
      setNewOAuthProviderId(account.providerId);
      setNewApiKeyOfficialProviderId(account.providerId);
    }
    setSelectedAccountId(account.id);
  }

  async function bindActiveProviderToAccount(account: AuthAccount) {
    if (!isOfficialProviderId(account.providerId)) return;
    const matchingProvider =
      activeProvider?.kind === "official" && activeProvider.providerId === account.providerId
        ? activeProvider
        : config.providers.find((provider) => provider.kind === "official" && provider.providerId === account.providerId);
    const provider =
      matchingProvider ??
      ({
        ...createOfficialProvider(),
        name: OFFICIAL_PROVIDER_LABELS[account.providerId],
        providerId: account.providerId,
      } satisfies Extract<Provider, { kind: "official" }>);
    const boundProvider = { ...provider, authMode: "account" as const, authAccountId: account.id, apiKey: "" };
    const providers = matchingProvider
      ? config.providers.map((item) => (item.id === provider.id ? boundProvider : item))
      : [...config.providers, boundProvider];
    const nextConfig = {
      ...config,
      activeProviderId: boundProvider.id,
      providers,
    };
    updateConfig(nextConfig);
    await saveAppConfig(nextConfig);
  }

  function addProvider() {
    const provider = createEmptyCustomProviderDraft();
    setProviderValidation((state) => ({ ...state, [provider.id]: {} }));
    setProviderDraft(provider);
    setShowKey(false);
    setProviderDrawerOpen(true);
  }

  function duplicateProvider() {
    if (!activeProvider) return;
    const clone: Provider = {
      ...structuredClone(activeProvider),
      id: `provider_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(6, "0").slice(0, 6)}`,
      name: `${activeProvider.name} Copy`,
    };
    setProviderValidation((state) => ({ ...state, [clone.id]: {} }));
    setProviderDraft(clone);
    setShowKey(false);
    setProviderDrawerOpen(true);
  }

  function deleteProvider() {
    if (!activeProvider) return;
    if (providerDraft?.id === activeProvider.id) {
      setProviderDraft(undefined);
      closeProviderDrawer();
      deleteDialogRef.current?.close();
      return;
    }
    const providers = config.providers.filter((provider) => provider.id !== activeProvider.id);
    setProviderValidation((state) => {
      const next = { ...state };
      delete next[activeProvider.id];
      return next;
    });
    updateConfig({ ...config, activeProviderId: providers[0]?.id, providers });
    closeProviderDrawer();
    deleteDialogRef.current?.close();
  }

  async function saveCurrentConfig(nextConfig = config, providerEntryId = nextConfig.activeProviderId) {
    const draftToSave = providerDraft?.id === providerEntryId ? providerDraft : undefined;
    const provider = draftToSave ?? nextConfig.providers.find((item) => item.id === providerEntryId);
    if (provider) markProviderAttempted(provider.id);
    if (Object.keys(validationErrors(provider)).length > 0) {
      showToast("error", t("validationFailed"));
      return undefined;
    }
    const configToSave =
      draftToSave
        ? {
            ...nextConfig,
            activeProviderId: draftToSave.id,
            providers: [...nextConfig.providers, draftToSave],
          }
        : nextConfig;
    setProviderBusy(true);
    try {
      await saveAppConfig(configToSave);
      if (draftToSave) {
        updateConfig(configToSave);
        setProviderDraft(undefined);
      }
      showToast("success", t("saveSuccess"));
      return configToSave;
    } catch (err) {
      showError(err);
      return undefined;
    } finally {
      setProviderBusy(false);
    }
  }

  async function testCurrentProvider(providerEntryId = activeProvider?.id) {
    if (!providerEntryId) return;
    const savedConfig = await saveCurrentConfig(config, providerEntryId);
    if (!savedConfig) return;
    updateConfig({ ...savedConfig, activeProviderId: providerEntryId });
    setProviderBusy(true);
    setTestState({ status: "running", output: 'pi -p "ping"\n' });
    try {
      const result = await runTestProvider(savedConfig, providerEntryId);
      const status = result.status;
      const exitLine = result.exitCode === undefined ? "" : `exitCode: ${result.exitCode}\n`;
      setTestState({
        status,
        output: `${exitLine}stdout:\n${result.stdout || ""}\n\nstderr:\n${result.stderr || ""}`,
      });
      showToast(status === "success" ? "success" : "error", status === "success" ? t("testSuccess") : t("testFailed"));
    } catch (err) {
      setTestState({ status: "failed", output: formatError(err, t) });
      showError(err);
    } finally {
      setProviderBusy(false);
    }
  }

  async function refreshPiModels() {
    if (!activeProvider || activeProvider.kind !== "official") return;
    setPiModelsLoading(true);
    try {
      const apiKey = activeProvider.authMode === "apiKey" ? activeProvider.apiKey : undefined;
      const models = await listPiModels(activeProvider.providerId, apiKey);
      setPiModels(models);
      showToast(models.length > 0 ? "success" : "info", models.length > 0 ? t("refreshPiModelsSuccess") : t("noAvailablePiModels"));
    } catch (err) {
      setPiModels([]);
      showError(err);
    } finally {
      setPiModelsLoading(false);
    }
  }

  async function loginOAuthProvider(provider: Extract<Provider, { kind: "official" }>) {
    if (oauthRunningRef.current) return;
    oauthRunningRef.current = true;
    openedOAuthUrlsRef.current.clear();
    setOAuthState({ providerId: provider.providerId, running: true, events: [] });
    try {
      const result = await loginOfficialProviderOAuth(provider.providerId);
      await refreshAccounts();
      const nextProvider = { ...provider, authMode: "account" as const, authAccountId: result.account.id };
      const nextConfig = {
        ...config,
        providers: config.providers.map((item) => (item.id === provider.id ? nextProvider : item)),
      };
      updateConfig(nextConfig);
      await saveAppConfig(nextConfig);
      await applyAuthAccount(result.account.id);
      await refreshAccounts();
      showToast("success", t("oauthLoginSuccess"));
    } catch (err) {
      showError(err);
    } finally {
      oauthRunningRef.current = false;
      setOAuthState((state) => ({ ...state, running: false }));
    }
  }

  async function addOAuthAccount(providerId = newOAuthProviderId) {
    if (oauthRunningRef.current) return;
    oauthRunningRef.current = true;
    oauthCallbackSubmittedRef.current = false;
    openedOAuthUrlsRef.current.clear();
    oauthInlineActiveRef.current = true;
    oauthInlineLoginIdRef.current = undefined;
    setOAuthCallbackInput("");
    setOAuthCallbackError("");
    setNewOAuthProviderId(providerId);
    setOAuthState({ providerId, running: true, events: [] });
    setAccountBusy(true);
    try {
      const result = await loginOfficialProviderOAuth(providerId, "");
      oauthInlineActiveRef.current = false;
      oauthCallbackSubmittedRef.current = false;
      const applied = await applyAuthAccount(result.account.id);
      await refreshAccounts();
      focusAccount(applied);
      await bindActiveProviderToAccount(applied);
      addAccountDialogRef.current?.close();
      showToast("success", t("accountSavedAndApplied"));
    } catch (err) {
      if (isOAuthCanceledError(err)) {
        // canceled: stay silent
      } else if (oauthCallbackSubmittedRef.current) {
        // submitted callback rejected by server: session is dead, return to idle (no restart)
        showToast("error", t("oauthCallbackInvalid"));
      } else {
        showError(err);
      }
    } finally {
      oauthInlineActiveRef.current = false;
      oauthCallbackSubmittedRef.current = false;
      oauthRunningRef.current = false;
      setOAuthState((state) => ({ ...state, running: false }));
      setAccountBusy(false);
    }
  }

  function isOAuthCanceledError(err: unknown) {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "OAUTH_LOGIN_CANCELED";
  }

  function submitOAuthCallback() {
    const value = oauthCallbackInput.trim();
    const loginId = oauthInlineLoginIdRef.current;
    if (!value || !loginId) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      setOAuthCallbackError(t("oauthCallbackInvalidInput"));
      return;
    }
    if (!parsed.searchParams.has("code") || !parsed.searchParams.has("state")) {
      setOAuthCallbackError(t("oauthCallbackInvalidInput"));
      return;
    }
    const authEvent = [...oauthState.events].reverse().find((event) => event.type === "auth");
    const authUrl = authEvent && authEvent.type === "auth" ? authEvent.url : undefined;
    if (authUrl) {
      try {
        const expectedState = new URL(authUrl).searchParams.get("state");
        if (expectedState && parsed.searchParams.get("state") !== expectedState) {
          setOAuthCallbackError(t("oauthCallbackInvalidInput"));
          return;
        }
      } catch {
        // auth URL unparseable: skip state cross-check, code+state presence already validated
      }
    }
    setOAuthCallbackError("");
    oauthCallbackSubmittedRef.current = true;
    submitOAuthManualCode(loginId, value).catch((err) => showError(err));
  }

  function cancelOAuthInline() {
    const loginId = oauthInlineLoginIdRef.current;
    oauthInlineActiveRef.current = false;
    oauthCallbackSubmittedRef.current = false;
    if (loginId) cancelOAuthLogin(loginId).catch(() => {});
  }

  function changeAddMode(mode: AddAccountMode) {
    if (mode !== "oauth" && oauthInlineActiveRef.current) cancelOAuthInline();
    setNewAccountMode(mode);
  }

  function handleAddDialogClose() {
    if (oauthInlineActiveRef.current) cancelOAuthInline();
  }

  async function addApiKeyAccount() {
    if (!newAccountProviderId.trim()) {
      showToast("error", t("required"));
      return;
    }
    if (!newAccountBaseUrl.trim()) {
      showToast("error", t("required"));
      return;
    }
    if (!newAccountApiKey.trim()) {
      showToast("error", t("required"));
      return;
    }
    setAccountBusy(true);
    try {
      const account = await createApiKeyAccount(newAccountProviderId, "", newAccountBaseUrl, newAccountApiKey);
      const applied = await applyAuthAccount(account.id);
      await refreshAccounts();
      focusAccount(applied);
      setNewAccountApiKey("");
      addAccountDialogRef.current?.close();
      showToast("success", t("accountSavedAndApplied"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function saveProviderApiKeyAsAccount(provider: Extract<Provider, { kind: "official" }>) {
    if (!provider.apiKey.trim()) {
      showToast("error", t("required"));
      return;
    }
    setAccountBusy(true);
    try {
      const label = `${provider.name || OFFICIAL_PROVIDER_LABELS[provider.providerId]} API Key`;
      const account = await createApiKeyAccount(provider.providerId, label, provider.advanced?.baseUrl ?? officialProviderBaseUrl(provider.providerId), provider.apiKey);
      await refreshAccounts();
      const nextProvider = { ...provider, authMode: "account" as const, authAccountId: account.id, apiKey: "" };
      const nextConfig = {
        ...config,
        providers: config.providers.map((item) => (item.id === provider.id ? nextProvider : item)),
      };
      updateConfig(nextConfig);
      await saveAppConfig(nextConfig);
      await applyAuthAccount(account.id);
      await refreshAccounts();
      showToast("success", t("providerApiKeySavedAsAccount"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function applySelectedAccount(account: AuthAccount) {
    setAccountBusy(true);
    try {
      const updated = await applyAuthAccount(account.id);
      await refreshAccounts();
      setSelectedAccountId(updated.id);
      await bindActiveProviderToAccount(updated);
      showToast("success", t("accountApplied"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function renameSelectedAccount(account: AuthAccount) {
    setRenameLabel(account.label);
    setRenameTarget(account);
    renameDialogRef.current?.showModal();
  }

  async function commitRename() {
    if (!renameTarget) return;
    const label = renameLabel.trim();
    if (!label) return;
    renameDialogRef.current?.close();
    setAccountBusy(true);
    try {
      const updated = await renameAuthAccount(renameTarget.id, label);
      await refreshAccounts();
      setSelectedAccountId(updated.id);
      showToast("success", t("accountSaved"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
      setRenameTarget(undefined);
    }
  }

  async function duplicateSelectedAccount(account: AuthAccount) {
    setAccountBusy(true);
    try {
      const duplicate = await duplicateAuthAccount(account.id);
      await refreshAccounts();
      focusAccount(duplicate);
      showToast("success", t("accountSaved"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function deleteSelectedAccount(account: AuthAccount) {
    setDeleteAccountTarget(account);
    deleteAccountDialogRef.current?.showModal();
  }

  async function commitDeleteAccount() {
    if (!deleteAccountTarget) return;
    deleteAccountDialogRef.current?.close();
    setAccountBusy(true);
    try {
      await deleteAuthAccount(deleteAccountTarget.id);
      const loaded = await loadAppConfig();
      setConfig(normalizeConfig(loaded.config));
      setPaths(loaded.resolvedPaths);
      await refreshAccounts();
      showToast("success", t("accountDeleted"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
      setDeleteAccountTarget(undefined);
    }
  }

  async function fetchModels() {
    if (!activeProvider || activeProvider.kind !== "custom") return;
    setFetching(true);
    setSelectedCandidates(new Set());
    setModelSearch("");
    if (!activeProvider.baseUrl.trim() || !activeProvider.apiKey.trim()) {
      setCandidateModels([]);
      showToast("error", t("fetchRequirements"));
      setFetching(false);
      return;
    }
    try {
      const models = await fetchCustomProviderModels(activeProvider.baseUrl, activeProvider.apiKey);
      setCandidateModels(models);
      showToast("success", t("fetchModelsSuccess"));
    } catch (err) {
      setCandidateModels([]);
      showError(err);
    } finally {
      setFetching(false);
    }
  }

  function addSelectedModels() {
    if (!activeProvider) return;
    const existing = new Set(activeProvider.models.map((model) => model.id));
    const additions = [...selectedCandidates]
      .map((id) => id.trim())
      .filter((id) => id && !existing.has(id))
      .map((id) => createModel(id));
    updateActiveProviderField(withValidDefaultModel({ ...activeProvider, models: [...activeProvider.models, ...additions] }), "models");
    setSelectedCandidates(new Set());
  }

  function openAddModelDialog(model?: ModelConfig) {
    setModelDraft({ model: model ? structuredClone(model) : createModel(), index: undefined });
    modelDialogRef.current?.showModal();
  }

  function openEditModelDialog(model: ModelConfig, index: number) {
    setModelDraft({ model: structuredClone(model), index });
    modelDialogRef.current?.showModal();
  }

  function saveModelDraft() {
    if (!activeProvider) return;
    const model = normalizeModelDraft(modelDraft.model);
    if (!model.id) return;
    const existsAt = activeProvider.models.findIndex((item, index) => item.id === model.id && index !== modelDraft.index);
    if (existsAt >= 0) return;
    const models =
      modelDraft.index === undefined
        ? [...activeProvider.models, model]
        : activeProvider.models.map((item, index) => (index === modelDraft.index ? model : item));
    updateActiveProviderField(withValidDefaultModel({ ...activeProvider, models, defaultModelId: activeProvider.defaultModelId || model.id }), "models");
    modelDialogRef.current?.close();
  }

  function removeModel(model: ModelConfig) {
    if (!activeProvider) return;
    updateActiveProviderField(withValidDefaultModel({ ...activeProvider, models: activeProvider.models.filter((item) => item.id !== model.id) }), "models");
  }

  function toggleOfficialModel(modelId: string, checked: boolean) {
    if (!activeProvider || activeProvider.kind !== "official") return;
    const models = checked
      ? [...activeProvider.models, { ...createModel(modelId), source: "builtin" as const }]
      : activeProvider.models.filter((model) => model.id !== modelId);
    updateActiveProviderField(withValidDefaultModel({ ...activeProvider, models, defaultModelId: activeProvider.defaultModelId || modelId }), "models");
  }

  function updateDefaultModel(defaultModelId: string) {
    if (!activeProvider) return;
    updateActiveProviderField({ ...activeProvider, defaultModelId }, "models");
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center gap-3" style={{ color: "var(--muted)" }}>
        <span className="spinner" aria-hidden="true" />
        <span>{t("running")}</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast ? <Toast toast={toast} onClose={() => setToast(undefined)} /> : null}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4v16M6 9h6a3 3 0 0 0 0-6H6M14 9v11" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">{t("title")}</span>
          </div>
        </div>

        <nav className="nav" role="tablist" aria-label={t("title")}>
          <button type="button" className="nav-tab" role="tab" aria-selected={activeTab === "accounts"} onClick={() => { closeProviderDrawer(); setActiveTab("accounts"); }}>
            <Users size={16} aria-hidden="true" />
            {t("accounts")}
            <span className="count">{accounts.length}</span>
          </button>
          <button type="button" className="nav-tab" role="tab" aria-selected={activeTab === "providers"} onClick={() => setActiveTab("providers")}>
            <Server size={16} aria-hidden="true" />
            {t("providers")}
            <span className="count">{config.providers.length}</span>
          </button>
        </nav>

        <div className="topbar-right">
          <div className="theme-seg" role="group" aria-label={t("theme")}>
            <button type="button" className={config.theme === "light" ? "active" : ""} title={t("light")} aria-label={t("light")} aria-pressed={config.theme === "light"} onClick={() => updateConfig({ ...config, theme: "light" })}>
              <Sun size={15} aria-hidden="true" />
            </button>
            <button type="button" className={config.theme === "dark" ? "active" : ""} title={t("dark")} aria-label={t("dark")} aria-pressed={config.theme === "dark"} onClick={() => updateConfig({ ...config, theme: "dark" })}>
              <Moon size={15} aria-hidden="true" />
            </button>
          </div>
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            align="right"
            trigger={
              <button type="button" className="icon-btn" title={t("settings")} aria-label={t("settings")} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}>
                <Settings size={17} aria-hidden="true" />
              </button>
            }
          >
            <label>
              <span>{t("language")}</span>
              <Select
                value={language}
                onChange={(value) => updateConfig({ ...config, language: value as AppConfig["language"] })}
                aria-label={t("language")}
                options={[
                  { value: "zh-CN", label: "中文" },
                  { value: "en-US", label: "English" },
                ]}
              />
            </label>
            <label>
              <span>{t("theme")}</span>
              <Select
                value={config.theme}
                onChange={(value) => updateConfig({ ...config, theme: value as ThemeMode })}
                aria-label={t("theme")}
                options={[
                  { value: "system", label: t("system") },
                  { value: "light", label: t("light") },
                  { value: "dark", label: t("dark") },
                ]}
              />
            </label>
          </Popover>
        </div>
      </header>

      <div className="main">
        {activeTab === "accounts" ? (
          <AccountsPanel
            accounts={accounts}
            filteredAccounts={filteredAccounts}
            selectedAccount={selectedAccount}
            activeAccount={accounts.find((account) => account.activeInPi)}
            providers={config.providers}
            customProviders={customProviderOptions}
            providerFilter={accountProviderFilter}
            oauthProviderId={newOAuthProviderId}
            apiKeyProviderSource={newApiKeyProviderSource}
            apiKeyOfficialProviderId={newApiKeyOfficialProviderId}
            apiKeyCustomProviderId={newApiKeyCustomProviderId}
            apiKeyProviderId={newAccountProviderId}
            baseUrl={newAccountBaseUrl}
            apiKey={newAccountApiKey}
            showApiKey={showAccountKey}
            busy={accountBusy}
            oauthState={oauthState}
            addDialogRef={addAccountDialogRef}
            addMode={newAccountMode}
            onProviderFilter={setAccountProviderFilter}
            onOAuthProviderId={setNewOAuthProviderId}
            onApiKeyProviderSource={setNewApiKeyProviderSource}
            onApiKeyOfficialProviderId={setNewApiKeyOfficialProviderId}
            onApiKeyCustomProviderId={setNewApiKeyCustomProviderId}
            onBaseUrl={setNewAccountBaseUrl}
            onApiKey={setNewAccountApiKey}
            onShowApiKey={setShowAccountKey}
            onAddMode={changeAddMode}
            onAddOAuth={addOAuthAccount}
            onSubmitCallback={submitOAuthCallback}
            onCancelOAuth={cancelOAuthInline}
            callback={oauthCallbackInput}
            callbackError={oauthCallbackError}
            onCallback={(value) => { setOAuthCallbackInput(value); setOAuthCallbackError(""); }}
            onDialogClose={handleAddDialogClose}
            onAddApiKey={addApiKeyAccount}
            onRefresh={refreshAccountState}
            onApply={applySelectedAccount}
            onRename={renameSelectedAccount}
            onDuplicate={duplicateSelectedAccount}
            onDelete={deleteSelectedAccount}
            onTest={testCurrentProvider}
            onSelect={setSelectedAccountId}
            t={t}
          />
        ) : (
          <ProvidersPanel
            config={config}
            activeProvider={activeProvider}
            accounts={accounts}
            errors={errors}
            showKey={showKey}
            setShowKey={setShowKey}
            providerBusy={providerBusy}
            accountBusy={accountBusy}
            piModels={piModels}
            piModelsLoading={piModelsLoading}
            piModelSearch={piModelSearch}
            candidateModels={candidateModels}
            selectedCandidates={selectedCandidates}
            modelSearch={modelSearch}
            fetching={fetching}
            oauthState={oauthState}
            testState={testState}
            drawerOpen={providerDrawerOpen}
            onSelectProvider={selectProvider}
            onCloseDrawer={closeProviderDrawer}
            onAddProvider={addProvider}
            onDuplicateProvider={duplicateProvider}
            onChangeProvider={updateActiveProviderField}
            onOpenDelete={() => deleteDialogRef.current?.showModal()}
            onOpenAdvanced={() => providerAdvancedDialogRef.current?.showModal()}
            onLoginOAuth={loginOAuthProvider}
            onSaveApiKeyAsAccount={saveProviderApiKeyAsAccount}
            onManageAccounts={manageAccountsForProvider}
            onRefreshPiModels={refreshPiModels}
            onPiModelSearch={setPiModelSearch}
            onToggleOfficialModel={toggleOfficialModel}
            onFetchModels={fetchModels}
            onModelSearch={setModelSearch}
            onSelectCandidates={setSelectedCandidates}
            onAddSelectedModels={addSelectedModels}
            onAddModel={() => openAddModelDialog()}
            onEditModel={openEditModelDialog}
            onRemoveModel={removeModel}
            onUpdateDefaultModel={updateDefaultModel}
            onSave={() => saveCurrentConfig(config, activeProvider?.id)}
            onTest={(providerEntryId) => {
              if (providerEntryId) {
                selectProvider(providerEntryId);
              }
              testCurrentProvider(providerEntryId ?? activeProvider?.id);
            }}
            onViewOutput={() => outputDialogRef.current?.showModal()}
            t={t}
          />
        )}
      </div>

      <dialog ref={outputDialogRef} className="dialog model-dialog p-4" aria-labelledby="output-dialog-title">
        <button type="button" className="dialog-close icon-button" aria-label={t("close")} onClick={() => outputDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="output-dialog-title" className="m-0 text-base font-semibold">{t("output")}</h3>
          <span className="muted">{testState.status === "idle" ? t("idleOutput") : t(testState.status)}</span>
        </div>
        <pre className="output">{testState.output || t("idleOutput")}</pre>
        {paths ? (
          <details className="muted">
            <summary>{t("paths")}</summary>
            <div className="model-id mt-2 grid gap-1">
              <span>{paths.appConfigFile}</span>
              <span>{paths.piModelsFile}</span>
              <span>{paths.piAuthFile}</span>
              <span>{paths.piSettingsFile}</span>
            </div>
          </details>
        ) : null}
      </dialog>

      <dialog ref={deleteDialogRef} className="dialog p-4" aria-labelledby="delete-provider-title">
        <p id="delete-provider-title">
          {t("deleteConfirmPrefix")} "{activeProvider?.name}"?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => deleteDialogRef.current?.close()}>
            {t("cancel")}
          </button>
          <button type="button" className="danger" onClick={deleteProvider}>
            {t("confirm")}
          </button>
        </div>
      </dialog>

      <dialog ref={modelDialogRef} className="dialog model-dialog p-4" aria-labelledby="model-dialog-title">
        <button type="button" className="dialog-close icon-button" aria-label={t("close")} onClick={() => modelDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <ModelConfigForm id="model-dialog-title" draft={modelDraft.model} providerKind={activeProvider?.kind ?? "custom"} onChange={(model) => setModelDraft({ ...modelDraft, model })} t={t} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => modelDialogRef.current?.close()}>
            {t("cancel")}
          </button>
          <button type="button" className="primary" onClick={saveModelDraft}>
            {t("confirm")}
          </button>
        </div>
      </dialog>

      <dialog ref={providerAdvancedDialogRef} className="dialog model-dialog p-4" aria-labelledby="advanced-dialog-title">
        <button type="button" className="dialog-close icon-button" aria-label={t("close")} onClick={() => providerAdvancedDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <h3 id="advanced-dialog-title" className="m-0 mb-4 text-base font-semibold">{t("providerAdvanced")}</h3>
        {activeProvider?.kind === "official" ? (
          <ProviderAdvancedForm value={activeProvider.advanced ?? {}} onChange={(advanced) => updateActiveProviderField({ ...activeProvider, advanced }, "headers")} errors={errors} t={t} />
        ) : null}
        {activeProvider?.kind === "custom" ? (
          <div className="grid gap-4">
            <Checkbox checked={activeProvider.authHeader ?? false} onChange={(authHeader) => updateActiveProviderField({ ...activeProvider, authHeader }, "headers")} label={t("authHeader")} help={t("authHeaderHelp")} />
            <HeadersEditor value={activeProvider.headers ?? []} onChange={(headers) => updateActiveProviderField({ ...activeProvider, headers }, "headers")} t={t} />
            <CompatForm value={activeProvider.compat ?? {}} onChange={(compat) => updateActiveProviderField({ ...activeProvider, compat }, "headers")} t={t} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="primary" onClick={() => providerAdvancedDialogRef.current?.close()}>
            {t("confirm")}
          </button>
        </div>
      </dialog>

      {/* Rename account dialog */}
      <dialog ref={renameDialogRef} className="dialog p-4" aria-labelledby="rename-account-title">
        <h3 id="rename-account-title" className="m-0 mb-3 text-base font-semibold">{t("renameAccount")}</h3>
        <Field label={t("accountName")}>
          <input
            value={renameLabel}
            onChange={(e) => setRenameLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); }}
          />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => renameDialogRef.current?.close()}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={commitRename} disabled={!renameLabel.trim()}>{t("confirm")}</button>
        </div>
      </dialog>

      {/* Delete account dialog */}
      <dialog ref={deleteAccountDialogRef} className="dialog p-4" aria-labelledby="delete-account-title">
        <p id="delete-account-title">
          {deleteAccountTarget?.activeInPi ? t("deleteActiveAccountConfirm") : t("deleteAccountConfirm")} "{deleteAccountTarget?.label}"?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => deleteAccountDialogRef.current?.close()}>{t("cancel")}</button>
          <button type="button" className="danger" onClick={commitDeleteAccount}>{t("confirm")}</button>
        </div>
      </dialog>

      {/* OAuth manual code dialog */}
      <dialog ref={oauthManualCodeDialogRef} className="dialog p-4" aria-labelledby="oauth-code-title">
        <h3 id="oauth-code-title" className="m-0 mb-3 text-base font-semibold">{t("oauthLogin")}</h3>
        <Field label={oauthManualCodeState?.message ?? t("oauthManualCodePrompt")}>
          <input
            value={oauthManualCodeInput}
            onChange={(e) => setOAuthManualCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const code = oauthManualCodeInput.trim();
                if (code && oauthManualCodeState) {
                  submitOAuthManualCode(oauthManualCodeState.loginId, code).catch((err) => showError(err));
                  oauthManualCodeDialogRef.current?.close();
                }
              }
            }}
          />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => oauthManualCodeDialogRef.current?.close()}>{t("cancel")}</button>
          <button
            type="button"
            className="primary"
            disabled={!oauthManualCodeInput.trim()}
            onClick={() => {
              const code = oauthManualCodeInput.trim();
              if (code && oauthManualCodeState) {
                submitOAuthManualCode(oauthManualCodeState.loginId, code).catch((err) => showError(err));
                oauthManualCodeDialogRef.current?.close();
              }
            }}
          >
            {t("confirm")}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = "right",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // Ignore interactions inside a portaled Select listbox: it renders into a
      // portal (document.body, or the nearest open dialog) outside this anchor,
      // so without this guard clicking an option would close the popover before
      // the option's onClick fires.
      if (target?.closest("[data-listbox]")) return;
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);
  return (
    <div className="popover-anchor" ref={anchorRef}>
      {trigger}
      {open ? (
        <div className={`popover ${className ?? ""}`} role="dialog" style={align === "left" ? { right: "auto", left: 0 } : undefined}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function providerAvatarClass(providerId: string): string {
  const normalized = providerId.toLowerCase();
  if (normalized.includes("codex") || normalized === "openai" || normalized.startsWith("openai")) return "codex";
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "anthropic";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("copilot")) return "copilot";
  if (isOfficialProviderId(providerId)) return "";
  return "relay";
}

function avatarInitial(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function accountAuthLabel(account: AuthAccount): "OAuth" | "API Key" {
  return account.kind === "oauth" ? "OAuth" : "API Key";
}

function providerIsApplied(provider: Provider, accounts: AuthAccount[]) {
  return provider.kind === "official" && provider.authMode === "account"
    ? accounts.some((account) => account.id === provider.authAccountId && account.activeInPi)
    : false;
}

function visibleProviderErrors(provider: Provider | undefined, state: ProviderValidationState) {
  const all = validationErrors(provider);
  if (!provider) return all;
  const validation = state[provider.id];
  if (validation?.attempted) return all;
  const touched = validation?.touched ?? {};
  return Object.fromEntries(Object.entries(all).filter(([field]) => touched[field]));
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const duration = toastDuration(toast.kind);
  return (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} style={{ "--toast-duration": `${duration}ms` } as React.CSSProperties}>
      <span>{toast.message}</span>
      <button type="button" className="icon-button" title="Close" onClick={onClose}>
        <X size={14} />
      </button>
      <span className="toast-progress" />
    </div>
  );
}

function toastDuration(kind: ToastState["kind"]) {
  return kind === "error" ? 5200 : 2800;
}

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label>
      <span>{label}{required ? <RequiredMark /> : null}</span>
      {children}
      <div className="field-error">{error}</div>
    </label>
  );
}

function LabeledField({ label, field, help, required, children }: { label: string; field?: string; help?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label>
      <span>
        {label}{required ? <RequiredMark /> : null}
        {help ? <InlineHelp help={help} /> : null}
        {field ? <code className="field-code">{field}</code> : null}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 text-sm font-semibold">{children}</h3>;
}

function SummaryHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="summary-label">
      <span>{label}</span>
      <span className="help-tip" tabIndex={0} aria-label={help}>
        <CircleHelp size={14} />
        <span className="help-popover">{help}</span>
      </span>
    </span>
  );
}

function InlineHelp({ help }: { help: string }) {
  return (
    <span className="help-tip inline-help" tabIndex={0} aria-label={help}>
      <CircleHelp size={13} />
      <span className="help-popover">{help}</span>
    </span>
  );
}

function AdvancedButton({ label, help, onClick }: { label: string; help: string; onClick: () => void }) {
  return (
    <div className="advanced-entry">
      <button type="button" className="flex items-center gap-2" onClick={onClick}>
        <Settings2 size={15} /> {label}
      </button>
      <InlineHelp help={help} />
    </div>
  );
}

function AccountsPanel({
  accounts,
  filteredAccounts,
  selectedAccount,
  activeAccount,
  providers,
  customProviders,
  providerFilter,
  oauthProviderId,
  apiKeyProviderSource,
  apiKeyOfficialProviderId,
  apiKeyCustomProviderId,
  apiKeyProviderId,
  baseUrl,
  apiKey,
  showApiKey,
  busy,
  oauthState,
  addDialogRef,
  addMode,
  onProviderFilter,
  onOAuthProviderId,
  onApiKeyProviderSource,
  onApiKeyOfficialProviderId,
  onApiKeyCustomProviderId,
  onBaseUrl,
  onApiKey,
  onShowApiKey,
  onAddMode,
  onAddOAuth,
  onSubmitCallback,
  onCancelOAuth,
  callback,
  callbackError,
  onCallback,
  onDialogClose,
  onAddApiKey,
  onRefresh,
  onApply,
  onRename,
  onDuplicate,
  onDelete,
  onTest,
  onSelect,
  t,
}: {
  accounts: AuthAccount[];
  filteredAccounts: AuthAccount[];
  selectedAccount?: AuthAccount;
  activeAccount?: AuthAccount;
  providers: Provider[];
  customProviders: Extract<Provider, { kind: "custom" }>[];
  providerFilter: AccountProviderFilter;
  oauthProviderId: OfficialProviderId;
  apiKeyProviderSource: ApiKeyProviderSource;
  apiKeyOfficialProviderId: OfficialProviderId;
  apiKeyCustomProviderId: string;
  apiKeyProviderId: string;
  baseUrl: string;
  apiKey: string;
  showApiKey: boolean;
  busy: boolean;
  oauthState: OAuthState;
  addDialogRef: React.RefObject<HTMLDialogElement | null>;
  addMode: AddAccountMode;
  onOAuthProviderId: (value: OfficialProviderId) => void;
  onApiKeyProviderSource: (value: ApiKeyProviderSource) => void;
  onApiKeyOfficialProviderId: (value: OfficialProviderId) => void;
  onApiKeyCustomProviderId: (value: string) => void;
  onBaseUrl: (value: string) => void;
  onApiKey: (value: string) => void;
  onShowApiKey: (value: boolean) => void;
  onAddMode: (value: AddAccountMode) => void;
  onAddOAuth: (providerId?: OfficialProviderId) => void;
  onSubmitCallback: () => void;
  onCancelOAuth: () => void;
  callback: string;
  callbackError: string;
  onCallback: (value: string) => void;
  onDialogClose: () => void;
  onAddApiKey: () => void;
  onRefresh: () => void;
  onApply: (account: AuthAccount) => void;
  onRename: (account: AuthAccount) => void;
  onDuplicate: (account: AuthAccount) => void;
  onDelete: (account: AuthAccount) => void;
  onTest: () => void;
  onSelect: (accountId: string) => void;
  onProviderFilter: (value: AccountProviderFilter) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const oauthSupported = supportsOAuthLogin(oauthProviderId);
  const oauthRunning = oauthState.running && oauthState.providerId === oauthProviderId;
  const oauthAuthEvent = oauthRunning ? [...oauthState.events].reverse().find((event) => event.type === "auth") : undefined;
  const oauthAuthUrl = oauthAuthEvent && oauthAuthEvent.type === "auth" ? oauthAuthEvent.url : undefined;
  const oauthDeviceEvent = oauthRunning ? [...oauthState.events].reverse().find((event) => event.type === "deviceCode") : undefined;
  const oauthDeviceCode = oauthDeviceEvent && oauthDeviceEvent.type === "deviceCode" ? oauthDeviceEvent : undefined;
  const providerFilterOptions = accountProviderFilterOptions(accounts, providers);
  const activeProviderForAccount = activeAccount
    ? providers.find((provider) => provider.kind === "official" && provider.authMode === "account" && provider.authAccountId === activeAccount.id)
    : undefined;
  return (
    <section className="screen" role="tabpanel" aria-label={t("accounts")}>
      <div className="page-head">
        <div className="page-title">
          <h1>{t("accounts")}</h1>
          <p>{t("accountsSubtitle")}</p>
        </div>
        <div className="head-actions">
          {accounts.length > 0 ? (
            <div className="scope" role="group" aria-label={t("accountFilter")}>
              <button type="button" className={providerFilter === "all" ? "active" : ""} onClick={() => onProviderFilter("all")}>
                {t("allAccounts")}
              </button>
              {providerFilterOptions.map((option) => (
                <button key={option.id} type="button" className={providerFilter === option.id ? "active" : ""} onClick={() => onProviderFilter(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn icon-only" title={t("refreshAccounts")} aria-label={t("refreshAccounts")} onClick={onRefresh} disabled={busy}>
            <RefreshCw size={15} />
          </button>
          <button type="button" className="btn primary" onClick={() => addDialogRef.current?.showModal()} disabled={busy}>
            <Plus size={15} /> {t("addAccount")}
          </button>
        </div>
      </div>

      <div className="scroll">
        {activeAccount ? (
          <div className="pi-strip">
            <div className="pi-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4v16M6 9h6a3 3 0 0 0 0-6H6M14 9v11" />
              </svg>
            </div>
            <div className="pi-body">
              <span className="pi-label">{t("currentInPi")}</span>
              <span className="pi-name">
                <span className="truncate">{activeAccount.label}</span>
                {accountIdentityText(activeAccount) ? <span className="dim">· {accountIdentityText(activeAccount)}</span> : null}
              </span>
            </div>
            <div className="pi-meta">
              <div className="pi-stat">
                <span className="k">{t("provider")}</span>
                <span className="v">{accountProviderLabel(activeAccount.providerId, providers)}</span>
              </div>
              {activeProviderForAccount?.defaultModelId ? (
                <div className="pi-stat">
                  <span className="k">{t("defaultModel")}</span>
                  <span className="v">{activeProviderForAccount.defaultModelId}</span>
                </div>
              ) : null}
              <div className="pi-stat">
                <span className="k">{t("authMode")}</span>
                <span className="v">{accountAuthLabel(activeAccount)}</span>
              </div>
              <button type="button" className="btn sm" onClick={onTest} disabled={busy || !activeProviderForAccount}>
                <ArrowRight size={14} /> {t("test")}
              </button>
            </div>
          </div>
        ) : (
          <div className="pi-strip empty">
            <div className="pi-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4v16M6 9h6a3 3 0 0 0 0-6H6M14 9v11" />
              </svg>
            </div>
            <div className="pi-body">
              <span className="pi-label">{t("currentInPi")}</span>
              <span className="pi-name"><span className="truncate">{t("noActiveAccount")}</span></span>
            </div>
          </div>
        )}

        {accounts.length === 0 ? (
          <section className="accounts-empty-state">
            <div className="empty-illustration" aria-hidden="true">
              <Users size={28} />
            </div>
            <SectionTitle>{t("noAccounts")}</SectionTitle>
            <p className="muted m-0">{t("noAccountsHelp")}</p>
          </section>
        ) : (
          <>
            <div className="list-head">
              <span>{t("accounts")}</span>
              <span>{t("provider")}</span>
              <span>{t("activeInPi")}</span>
              <span className="right">{t("authMode")}</span>
            </div>
            {filteredAccounts.length === 0 ? (
              <div className="empty-state">{t("noAccountsMatchFilter")}</div>
            ) : (
              <div className="list">
                {filteredAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    selected={account.id === selectedAccount?.id}
                    providers={providers}
                    busy={busy}
                    onSelect={onSelect}
                    onApply={onApply}
                    onRename={onRename}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    t={t}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <dialog ref={addDialogRef} className="dialog model-dialog p-4" aria-labelledby="add-account-dialog-title" onClose={onDialogClose}>
        <button type="button" className="dialog-close icon-button" aria-label={t("close")} onClick={() => addDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <h3 id="add-account-dialog-title" className="m-0 mb-4 text-base font-semibold">{t("addAccount")}</h3>
        <div className="segmented mb-4" role="tablist" aria-label={t("addAccount")}>
          <button type="button" role="tab" aria-selected={addMode === "oauth"} className={addMode === "oauth" ? "primary" : ""} onClick={() => onAddMode("oauth")}>
            {t("oauthLogin")}
          </button>
          <button type="button" role="tab" aria-selected={addMode === "apiKey"} className={addMode === "apiKey" ? "primary" : ""} onClick={() => onAddMode("apiKey")}>
            {t("apiKeyAccount")}
          </button>
        </div>
        {addMode === "oauth" ? (
          <div className="grid gap-4">
            <Field label={t("provider")}>
              <Select
                value={oauthProviderId}
                disabled={oauthRunning}
                aria-label={t("provider")}
                onChange={(value) => onOAuthProviderId(value as OfficialProviderId)}
                options={OFFICIAL_PROVIDER_IDS.filter(supportsOAuthLogin).map((id) => ({
                  value: id,
                  label: OFFICIAL_PROVIDER_LABELS[id],
                }))}
              />
            </Field>
            {!oauthRunning ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => addDialogRef.current?.close()}>{t("cancel")}</button>
                <button type="button" className="primary flex items-center gap-2" onClick={() => onAddOAuth()} disabled={busy || !oauthSupported}>
                  <Plus size={15} /> {t("startOAuth")}
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {oauthAuthUrl ? (
                  <>
                    <Field label={t("oauthAuthLink")}>
                      <div className="flex items-start gap-2">
                        <textarea
                          readOnly
                          value={oauthAuthUrl}
                          rows={3}
                          onFocus={(event) => event.currentTarget.select()}
                          className="w-full resize-y rounded-md border px-2 py-1.5 font-mono text-xs leading-relaxed"
                          style={{ borderColor: "var(--border)", wordBreak: "break-all", whiteSpace: "pre-wrap" }}
                        />
                        <button type="button" className="icon-button" title={t("copy")} onClick={() => { void navigator.clipboard?.writeText(oauthAuthUrl); }}>
                          <Copy size={15} />
                        </button>
                      </div>
                    </Field>
                    <button type="button" className="primary flex items-center justify-center gap-2" onClick={() => { void openUrl(oauthAuthUrl); }}>
                      <ExternalLink size={15} /> {t("openInBrowser")}
                    </button>
                    <Field label={t("oauthCallbackLabel")}>
                      <div className="flex gap-2">
                        <input value={callback} placeholder={t("oauthCallbackPlaceholder")} onChange={(event) => onCallback(event.target.value)} />
                        <button type="button" className="flex items-center gap-2 whitespace-nowrap" onClick={onSubmitCallback} disabled={!callback.trim()}>
                          <Check size={15} /> {t("oauthCallbackContinue")}
                        </button>
                      </div>
                      {callbackError ? <div className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{callbackError}</div> : null}
                    </Field>
                  </>
                ) : oauthDeviceCode ? (
                  <>
                    <Field label={t("oauthDeviceCodeLabel")}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-mono tracking-widest">{oauthDeviceCode.userCode}</span>
                        <button type="button" className="icon-button" title={t("copy")} onClick={() => { void navigator.clipboard?.writeText(oauthDeviceCode.userCode); }}>
                          <Copy size={15} />
                        </button>
                      </div>
                    </Field>
                    <Field label={t("oauthVerificationPage")}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs break-all" style={{ color: "var(--muted)" }}>{oauthDeviceCode.verificationUri}</span>
                        <button type="button" className="primary flex items-center gap-2 whitespace-nowrap" onClick={() => { void openUrl(oauthDeviceCode.verificationUri); }}>
                          <ExternalLink size={15} /> {t("openInBrowser")}
                        </button>
                      </div>
                    </Field>
                    <div className="muted">{t("oauthDeviceCodeHint")}</div>
                  </>
                ) : (
                  <div className="muted">{t("oauthGeneratingLink")}</div>
                )}
                {oauthState.events.length > 0 ? <OAuthEventList events={oauthState.events} t={t} /> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={onCancelOAuth}>{t("cancel")}</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="segmented" role="group" aria-label={t("providerSource")}>
              <button type="button" className={apiKeyProviderSource === "official" ? "primary" : ""} onClick={() => onApiKeyProviderSource("official")}>
                {t("official")}
              </button>
              <button type="button" className={apiKeyProviderSource === "custom" ? "primary" : ""} onClick={() => onApiKeyProviderSource("custom")} disabled={customProviders.length === 0}>
                {t("custom")}
              </button>
            </div>
            {apiKeyProviderSource === "official" ? (
              <Field label={t("provider")}>
                <Select
                  value={apiKeyOfficialProviderId}
                  aria-label={t("provider")}
                  onChange={(value) => onApiKeyOfficialProviderId(value as OfficialProviderId)}
                  options={OFFICIAL_PROVIDER_IDS.map((id) => ({
                    value: id,
                    label: OFFICIAL_PROVIDER_LABELS[id],
                  }))}
                />
              </Field>
            ) : (
              <Field label={t("provider")}>
                <Select
                  value={apiKeyCustomProviderId}
                  aria-label={t("provider")}
                  disabled={customProviders.length === 0}
                  onChange={onApiKeyCustomProviderId}
                  options={customProviders.map((provider) => ({ value: provider.id, label: provider.name }))}
                />
              </Field>
            )}
            <Field label={t("baseUrl")} required>
              <input value={baseUrl} onChange={(event) => onBaseUrl(event.target.value)} />
            </Field>
            <SecretField value={apiKey} onChange={onApiKey} showKey={showApiKey} setShowKey={onShowApiKey} required t={t} />
            <div className="muted">{apiKeyProviderSource === "custom" ? t("apiKeyCustomProviderHelp") : t("apiKeyOfficialProviderHelp")}</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => addDialogRef.current?.close()}>{t("cancel")}</button>
              <button type="button" className="primary flex items-center gap-2" onClick={onAddApiKey} disabled={busy || !apiKeyProviderId.trim() || !baseUrl.trim() || !apiKey.trim()}>
                <Plus size={15} /> {t("addApiKeyAccount")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

function AccountRow({
  account,
  selected,
  providers,
  busy,
  onSelect,
  onApply,
  onRename,
  onDuplicate,
  onDelete,
  t,
}: {
  account: AuthAccount;
  selected: boolean;
  providers: Provider[];
  busy: boolean;
  onSelect: (accountId: string) => void;
  onApply: (account: AuthAccount) => void;
  onRename: (account: AuthAccount) => void;
  onDuplicate: (account: AuthAccount) => void;
  onDelete: (account: AuthAccount) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = accountIdentityText(account);
  const auth = accountAuthLabel(account);
  return (
    <div
      className={`row ${account.activeInPi ? "active" : ""} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(account.id)}
    >
      <div className="cell-name">
        <div className={`avatar ${providerAvatarClass(account.providerId)}`} aria-hidden="true">{avatarInitial(account.label)}</div>
        <div className="name-text">
          <span className="n"><span className="truncate">{account.label}</span></span>
          <span className="id">{identity || account.baseUrl || account.providerId}</span>
        </div>
      </div>
      <div className="cell-provider">
        <span className="pv">{accountProviderLabel(account.providerId, providers)}</span>
        <span className="pv-sub">{isOfficialProviderId(account.providerId) ? t("official") : t("custom")}</span>
      </div>
      <div className="cell-state">
        {account.activeInPi ? (
          <span className="badge-active">
            <Check size={12} /> {t("activeInPi")}
          </span>
        ) : (
          <span className={`tag ${auth === "OAuth" ? "oauth" : "apikey"}`}><span className="dot" />{auth}</span>
        )}
      </div>
      <div className="cell-action" onClick={(event) => event.stopPropagation()}>
        {!account.activeInPi ? (
          <button type="button" className="apply-btn" onClick={() => onApply(account)} disabled={busy}>
            <ArrowRight size={14} /> {t("applyAccount")}
          </button>
        ) : null}
        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          className="popover-menu"
          trigger={
            <button type="button" className="kebab" title={t("more")} aria-label={t("more")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <MoreVertical size={16} />
            </button>
          }
        >
          <button type="button" onClick={() => { setMenuOpen(false); onRename(account); }} disabled={busy}>
            <Settings2 size={14} /> {t("renameAccount")}
          </button>
          <button type="button" onClick={() => { setMenuOpen(false); onDuplicate(account); }} disabled={busy}>
            <Copy size={14} /> {t("duplicate")}
          </button>
          <button type="button" className="danger" onClick={() => { setMenuOpen(false); onDelete(account); }} disabled={busy}>
            <Trash2 size={14} /> {t("delete")}
          </button>
        </Popover>
      </div>
    </div>
  );
}

function ProvidersPanel({
  config,
  activeProvider,
  accounts,
  errors,
  showKey,
  setShowKey,
  providerBusy,
  accountBusy,
  piModels,
  piModelsLoading,
  piModelSearch,
  candidateModels,
  selectedCandidates,
  modelSearch,
  fetching,
  oauthState,
  testState,
  drawerOpen,
  onSelectProvider,
  onCloseDrawer,
  onAddProvider,
  onDuplicateProvider,
  onChangeProvider,
  onOpenDelete,
  onOpenAdvanced,
  onLoginOAuth,
  onSaveApiKeyAsAccount,
  onManageAccounts,
  onRefreshPiModels,
  onPiModelSearch,
  onToggleOfficialModel,
  onFetchModels,
  onModelSearch,
  onSelectCandidates,
  onAddSelectedModels,
  onAddModel,
  onEditModel,
  onRemoveModel,
  onUpdateDefaultModel,
  onSave,
  onTest,
  onViewOutput,
  t,
}: {
  config: AppConfig;
  activeProvider?: Provider;
  accounts: AuthAccount[];
  errors: Record<string, string>;
  showKey: boolean;
  setShowKey: (show: boolean) => void;
  providerBusy: boolean;
  accountBusy: boolean;
  piModels: PiModelInfo[];
  piModelsLoading: boolean;
  piModelSearch: string;
  candidateModels: string[];
  selectedCandidates: Set<string>;
  modelSearch: string;
  fetching: boolean;
  oauthState: OAuthState;
  testState: TestState;
  drawerOpen: boolean;
  onSelectProvider: (id: string) => void;
  onCloseDrawer: () => void;
  onAddProvider: () => void;
  onDuplicateProvider: () => void;
  onChangeProvider: (provider: Provider, field: string) => void;
  onOpenDelete: () => void;
  onOpenAdvanced: () => void;
  onLoginOAuth: (provider: Extract<Provider, { kind: "official" }>) => void;
  onSaveApiKeyAsAccount: (provider: Extract<Provider, { kind: "official" }>) => void;
  onManageAccounts: (providerId: OfficialProviderId) => void;
  onRefreshPiModels: () => void;
  onPiModelSearch: (value: string) => void;
  onToggleOfficialModel: (modelId: string, checked: boolean) => void;
  onFetchModels: () => void;
  onModelSearch: (value: string) => void;
  onSelectCandidates: (value: Set<string>) => void;
  onAddSelectedModels: () => void;
  onAddModel: () => void;
  onEditModel: (model: ModelConfig, index: number) => void;
  onRemoveModel: (model: ModelConfig) => void;
  onUpdateDefaultModel: (defaultModelId: string) => void;
  onSave: () => void;
  onTest: (providerEntryId?: string) => void;
  onViewOutput: () => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const officialProviders = config.providers.filter((provider) => provider.kind === "official");
  const customProviders = config.providers.filter((provider) => provider.kind === "custom");
  const isApplied = (provider: Provider) => providerIsApplied(provider, accounts);
  const isPersistedActiveProvider = activeProvider ? config.providers.some((provider) => provider.id === activeProvider.id) : false;
  const isNewProviderDraft = activeProvider ? !isPersistedActiveProvider : false;
  const renderProviderRow = (provider: Provider) => (
    <div
      key={provider.id}
      className={`prov-row ${provider.id === config.activeProviderId ? "active" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={provider.id === config.activeProviderId}
      onClick={() => onSelectProvider(provider.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectProvider(provider.id);
        }
      }}
    >
      <span className={`pi-dot avatar ${providerAvatarClass(piProviderId(provider))}`} aria-hidden="true">{avatarInitial(provider.name)}</span>
      <span className="prov-main">
        <span className="pn">
          <span className="truncate">{provider.name}</span>
          {isApplied(provider) ? <span className="badge-active"><Check size={12} /> {t("activeInPi")}</span> : null}
        </span>
        <span className="pt">{providerSummary(provider, accounts, t)}</span>
      </span>
      <span className="prov-kind">{provider.kind === "official" ? t("official") : t("custom")}</span>
      <span className="prov-model">{provider.defaultModelId || t("noDefaultModel")}</span>
      <span className="prov-row-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="btn sm" onClick={() => onTest(provider.id)} disabled={providerBusy}>
          <CirclePlay size={14} /> {t("test")}
        </button>
      </span>
    </div>
  );
  const providerDrawer =
    activeProvider && drawerOpen ? (
      <div className="provider-drawer-backdrop" role="presentation" onClick={onCloseDrawer}>
        <aside className="provider-drawer" role="dialog" aria-modal="true" aria-labelledby="provider-drawer-title" onClick={(event) => event.stopPropagation()}>
          <div className="provider-drawer-head">
            <div className="form-top">
              <div className={`ft-icon avatar ${providerAvatarClass(piProviderId(activeProvider))}`}>{avatarInitial(activeProvider.name)}</div>
              <div className="ft-text">
                <h2 id="provider-drawer-title">
                  {activeProvider.name}
                  {isApplied(activeProvider) ? (
                    <span className="badge-active"><Check size={12} /> {t("activeInPi")}</span>
                  ) : null}
                </h2>
                <p>{activeProvider.kind === "official" ? t("official") : t("custom")} · {providerLabel(activeProvider)}</p>
              </div>
            </div>
            <button type="button" className="icon-button" aria-label={t("close")} onClick={onCloseDrawer}>
              <X size={16} />
            </button>
          </div>

          <div className="prov-form">
            <div className="card">
              <div className="card-title">{t("basicInfo")}</div>
              <div className="editor-grid grid grid-cols-2 gap-4">
                <Field label={t("name")} error={fieldError(errors.name, t)} required>
                  <input value={activeProvider.name} onChange={(event) => onChangeProvider({ ...activeProvider, name: event.target.value }, "name")} />
                </Field>
                <Field label={t("kind")}>
                  <Select
                    value={activeProvider.kind}
                    aria-label={t("kind")}
                    onChange={(value) => {
                      const replacement = value === "official"
                        ? (isNewProviderDraft ? createEmptyOfficialProviderDraft() : createOfficialProvider())
                        : (isNewProviderDraft ? createEmptyCustomProviderDraft() : createCustomProvider());
                      onChangeProvider({ ...replacement, id: activeProvider.id, name: activeProvider.name }, "kind");
                    }}
                    options={[
                      { value: "official", label: t("official") },
                      { value: "custom", label: t("custom") },
                    ]}
                  />
                </Field>
              </div>
              {activeProvider.kind === "official" ? (
                <OfficialProviderForm
                  provider={activeProvider}
                  isNewDraft={isNewProviderDraft}
                  onChange={onChangeProvider}
                  errors={errors}
                  showKey={showKey}
                  setShowKey={setShowKey}
                  onOpenAdvanced={onOpenAdvanced}
                  onLoginOAuth={onLoginOAuth}
                  onSaveApiKeyAsAccount={onSaveApiKeyAsAccount}
                  onManageAccounts={onManageAccounts}
                  oauthState={oauthState}
                  accounts={accounts}
                  busy={accountBusy}
                  t={t}
                />
              ) : (
                <CustomProviderForm
                  provider={activeProvider}
                  onChange={onChangeProvider}
                  errors={errors}
                  showKey={showKey}
                  setShowKey={setShowKey}
                  onOpenAdvanced={onOpenAdvanced}
                  t={t}
                />
              )}
            </div>

            <div className="card">
              <div className="card-title">
                {t("models")}
                {activeProvider.kind === "official" ? (
                  <button type="button" className="btn sm ghost" style={{ marginLeft: "auto", height: 26 }} onClick={onRefreshPiModels} disabled={piModelsLoading}>
                    <RefreshCw size={14} /> {t("refreshPiModels")}
                  </button>
                ) : (
                  <button type="button" className="btn sm ghost" style={{ marginLeft: "auto", height: 26 }} onClick={onFetchModels} disabled={fetching}>
                    <Download size={14} /> {t("fetchModels")}
                  </button>
                )}
                <button type="button" className="btn sm" style={{ height: 26 }} onClick={onAddModel}>
                  <Plus size={14} /> {t("addModel")}
                </button>
              </div>
              {activeProvider.kind === "official" ? (
                <OfficialModelSelector
                  provider={activeProvider}
                  piModels={piModels}
                  loading={piModelsLoading}
                  search={piModelSearch}
                  onSearch={onPiModelSearch}
                  onToggle={onToggleOfficialModel}
                  onEdit={onEditModel}
                  onRemove={onRemoveModel}
                  t={t}
                />
              ) : (
                <CustomModelSelector
                  provider={activeProvider}
                  candidateModels={candidateModels}
                  selectedCandidates={selectedCandidates}
                  search={modelSearch}
                  fetching={fetching}
                  onSearch={onModelSearch}
                  onSelect={onSelectCandidates}
                  onAddSelected={onAddSelectedModels}
                  onEdit={onEditModel}
                  onRemove={onRemoveModel}
                  t={t}
                />
              )}
              <Field label={t("defaultModel")} error={fieldError(errors.models, t)} required>
                <Select
                  value={activeProvider.defaultModelId}
                  aria-label={t("defaultModel")}
                  disabled={enabledModels(activeProvider).length === 0}
                  onChange={onUpdateDefaultModel}
                  options={enabledModels(activeProvider).map((model) => ({ value: model.id, label: model.id }))}
                />
              </Field>
            </div>

            <div className="form-footer">
              <div className="left">
                <span className="muted" style={{ fontSize: "11.5px" }}>{testState.status === "idle" ? t("autoStaged") : t(testState.status)}</span>
              </div>
              <div className="right">
                <button type="button" className="btn" onClick={onSave} disabled={providerBusy}>
                  <Save size={15} /> {t("save")}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    ) : null;
  return (
    <section className="screen" role="tabpanel" aria-label={t("providers")}>
      <div className="page-head">
        <div className="page-title">
          <h1>{t("providers")}</h1>
          <p>{t("providersSubtitle")}</p>
        </div>
      </div>

      {config.providers.length === 0 ? (
        <div className="prov-stack">
          <div className="provider-actionbar">
            <button type="button" className="btn primary" onClick={onAddProvider}>
              <Plus size={15} /> {t("newProvider")}
            </button>
          </div>
          <div className="prov-empty">
            <div className="empty-illustration" aria-hidden="true">
              <Server size={28} />
            </div>
            <p className="muted m-0">{t("noProvider")}</p>
          </div>
        </div>
      ) : (
        <div className="prov-stack">
          <div className="provider-actionbar">
            <div className="left">
              <button type="button" className="btn primary" onClick={onAddProvider}>
                <Plus size={15} /> {t("newProvider")}
              </button>
              {activeProvider && isPersistedActiveProvider ? (
                <button type="button" className="btn" onClick={onDuplicateProvider}>
                  <Copy size={15} /> {t("duplicate")}
                </button>
              ) : null}
            </div>
            <div className="right">
              <button type="button" className="btn sm ghost" onClick={onViewOutput}>
                {t("viewOutput")}
              </button>
              {activeProvider && isPersistedActiveProvider ? (
                <button type="button" className="btn sm danger-text" onClick={onOpenDelete}>
                  <Trash2 size={14} /> {t("delete")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="provider-table" aria-label={t("providers")}>
            <div className="provider-table-head">
              <span>{t("provider")}</span>
              <span>{t("kind")}</span>
              <span>{t("defaultModel")}</span>
              <span>{t("actions")}</span>
            </div>
            {officialProviders.length > 0 ? <div className="prov-list-label">{t("official")}</div> : null}
            {officialProviders.map(renderProviderRow)}
            {customProviders.length > 0 ? <div className="prov-list-label">{t("custom")}</div> : null}
            {customProviders.map(renderProviderRow)}
          </div>

          {!activeProvider ? (
            <div className="prov-empty">
              <div className="grid gap-3 text-center">
                <p className="muted m-0">{t("noProvider")}</p>
                <button type="button" className="btn primary mx-auto" onClick={onAddProvider}>
                  <Plus size={15} /> {t("newProvider")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {providerDrawer}
    </section>
  );
}

function providerSummary(provider: Provider, accounts: AuthAccount[], t: ReturnType<typeof createTranslator>) {
  if (provider.kind === "custom") {
    return provider.baseUrl || provider.api || t("custom");
  }
  if (provider.authMode === "account") {
    const account = accounts.find((item) => item.id === provider.authAccountId);
    const accountPart = account ? `${t("authAccount")} · ${account.label}` : t("authAccount");
    return provider.defaultModelId ? `${accountPart} · ${provider.defaultModelId}` : accountPart;
  }
  if (provider.authMode === "apiKey") return t("authApiKey");
  return provider.defaultModelId ? `${t("authExisting")} · ${provider.defaultModelId}` : t("authExisting");
}

function OfficialProviderForm({
  provider,
  isNewDraft,
  onChange,
  errors,
  showKey,
  setShowKey,
  onOpenAdvanced,
  onLoginOAuth,
  onSaveApiKeyAsAccount,
  onManageAccounts,
  oauthState,
  accounts,
  busy,
  t,
}: {
  provider: Extract<Provider, { kind: "official" }>;
  isNewDraft: boolean;
  onChange: (provider: Provider, field: string) => void;
  errors: Record<string, string>;
  showKey: boolean;
  setShowKey: (show: boolean) => void;
  onOpenAdvanced: () => void;
  onLoginOAuth: (provider: Extract<Provider, { kind: "official" }>) => void;
  onSaveApiKeyAsAccount: (provider: Extract<Provider, { kind: "official" }>) => void;
  onManageAccounts: (providerId: OfficialProviderId) => void;
  oauthState: OAuthState;
  accounts: AuthAccount[];
  busy: boolean;
  t: ReturnType<typeof createTranslator>;
}) {
  const oauthSupported = supportsOAuthLogin(provider.providerId);
  const oauthRunning = oauthState.running && oauthState.providerId === provider.providerId;
  const oauthDisabled = oauthState.running || busy;
  const providerAccounts = accounts.filter((account) => account.providerId === provider.providerId);
  const authOptions: { mode: AuthMode; title: string; desc: string }[] = [
    { mode: "existing", title: t("authExisting"), desc: t("oauthLoginHelp") },
    { mode: "account", title: t("authAccount"), desc: t("saveApiKeyAsAccountHelp") },
    { mode: "apiKey", title: t("authApiKey"), desc: t("providerApiKeyOverrideHelp") },
  ];
  return (
    <div className="grid gap-4">
      <Field label={t("provider")}>
        <Select
          value={provider.providerId}
          aria-label={t("provider")}
          onChange={(value) => {
            const providerId = value as OfficialProviderId;
            onChange({
              ...provider,
              providerId,
              authAccountId: undefined,
              authMode: isNewDraft ? "apiKey" : provider.authMode,
              models: [],
              defaultModelId: "",
            }, "models");
          }}
          options={OFFICIAL_PROVIDER_IDS.map((providerId) => ({
            value: providerId,
            label: OFFICIAL_PROVIDER_LABELS[providerId],
          }))}
        />
      </Field>
      {isNewDraft ? null : (
        <div>
          <span className="field-label">{t("authMode")}</span>
          <div className="auth-cards" role="radiogroup" aria-label={t("authMode")}>
            {authOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={provider.authMode === option.mode}
                className={`auth-card ${provider.authMode === option.mode ? "sel" : ""}`}
                onClick={() => onChange({ ...provider, authMode: option.mode }, option.mode === "apiKey" ? "apiKey" : option.mode === "account" ? "authAccountId" : "authMode")}
              >
                <span className="ac-top">
                  <span className="ac-radio" aria-hidden="true" />
                  <span className="ac-title">{option.title}</span>
                </span>
                <span className="ac-desc">{option.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {provider.authMode === "account" ? (
        <Field label={t("account")} error={fieldError(errors.authAccountId, t)} required>
          <div className="editor-grid grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Select
              value={provider.authAccountId ?? ""}
              aria-label={t("account")}
              placeholder={t("selectAccount")}
              onChange={(value) => onChange({ ...provider, authAccountId: value }, "authAccountId")}
              options={[
                { value: "", label: t("selectAccount") },
                ...providerAccounts.map((account) => ({ value: account.id, label: accountOptionLabel(account, t) })),
              ]}
            />
            <button type="button" onClick={() => onManageAccounts(provider.providerId)}>
              {t("manageAccounts")}
            </button>
          </div>
        </Field>
      ) : null}
      {provider.authMode === "apiKey" ? (
        <div className="grid gap-2">
          <SecretField value={provider.apiKey} onChange={(apiKey) => onChange({ ...provider, apiKey }, "apiKey")} showKey={showKey} setShowKey={setShowKey} error={fieldError(errors.apiKey, t)} required t={t} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onSaveApiKeyAsAccount(provider)} disabled={busy || !provider.apiKey.trim()}>
              {t("saveApiKeyAsAccount")}
            </button>
            <span className="muted">{t("saveApiKeyAsAccountHelp")}</span>
          </div>
        </div>
      ) : null}
      {oauthSupported ? (
        <section className="grid gap-2 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-sm">{t("oauthLogin")}</strong>
              <div className="muted">{t("oauthLoginHelp")}</div>
            </div>
            <button type="button" onClick={() => onLoginOAuth(provider)} disabled={oauthDisabled}>
              {oauthRunning ? t("running") : t("oauthLogin")}
            </button>
          </div>
          {oauthState.providerId === provider.providerId && oauthState.events.length > 0 ? <OAuthEventList events={oauthState.events} t={t} /> : null}
        </section>
      ) : null}
      <AdvancedButton onClick={onOpenAdvanced} label={t("providerAdvanced")} help={t("providerAdvancedHelp")} />
    </div>
  );
}

function OAuthEventList({ events, t }: { events: OAuthLoginEvent[]; t: ReturnType<typeof createTranslator> }) {
  const visibleEvents = events
    .map((event) => formatOAuthEvent(event, t))
    .filter((message): message is string => Boolean(message));
  if (visibleEvents.length === 0) return null;
  return (
    <div className="grid gap-1" aria-live="polite" aria-atomic="false">
      {visibleEvents.map((message, index) => (
        <div key={`${message}-${index}`} className="oauth-event muted">
          {message}
        </div>
      ))}
    </div>
  );
}

function formatOAuthEvent(event: OAuthLoginEvent, t: ReturnType<typeof createTranslator>) {
  if (event.type === "started" || event.type === "auth" || event.type === "manualCode") return undefined;
  if (event.type === "deviceCode") return `${t("oauthDeviceCode")}: ${event.userCode} / ${event.verificationUri}`;
  if (event.type === "prompt") return `${t("oauthPrompt")}: ${event.message}`;
  if (event.type === "progress") return event.message;
  if (event.type === "success") return event.message ?? t("oauthLoginSuccess");
  if (event.type === "select") return `${event.message}: ${event.selected ?? ""}`;
  return undefined;
}

function CustomProviderForm({
  provider,
  onChange,
  errors,
  showKey,
  setShowKey,
  onOpenAdvanced,
  t,
}: {
  provider: Extract<Provider, { kind: "custom" }>;
  onChange: (provider: Provider, field: string) => void;
  errors: Record<string, string>;
  showKey: boolean;
  setShowKey: (show: boolean) => void;
  onOpenAdvanced: () => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <div className="grid gap-4">
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Field label={t("baseUrl")} error={fieldError(errors.baseUrl, t)} required>
          <input value={provider.baseUrl} onChange={(event) => onChange({ ...provider, baseUrl: event.target.value }, "baseUrl")} />
        </Field>
        <ApiSelect value={provider.api} onChange={(api) => onChange({ ...provider, api }, "api")} label={t("apiType")} error={fieldError(errors.api, t)} required />
      </div>
      <SecretField value={provider.apiKey} onChange={(apiKey) => onChange({ ...provider, apiKey }, "apiKey")} showKey={showKey} setShowKey={setShowKey} error={fieldError(errors.apiKey, t)} required t={t} />
      <AdvancedButton onClick={onOpenAdvanced} label={t("providerAdvanced")} help={t("providerAdvancedHelp")} />
    </div>
  );
}

function SecretField({
  value,
  onChange,
  showKey,
  setShowKey,
  error,
  required,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  showKey: boolean;
  setShowKey: (show: boolean) => void;
  error?: string;
  required?: boolean;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <Field label={t("apiKey")} error={error} required={required}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input type={showKey ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="icon-button" title={showKey ? t("hide") : t("show")} onClick={() => setShowKey(!showKey)}>
          {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </Field>
  );
}

function ProviderAdvancedForm({
  value,
  onChange,
  errors,
  t,
}: {
  value: NonNullable<Extract<Provider, { kind: "official" }>["advanced"]>;
  onChange: (value: NonNullable<Extract<Provider, { kind: "official" }>["advanced"]>) => void;
  errors: Record<string, string>;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <div className="grid gap-4 pt-3">
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Field label={t("baseUrl")}>
          <input value={value.baseUrl ?? ""} onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} />
        </Field>
        <ApiSelect value={value.api ?? ""} onChange={(api) => onChange({ ...value, api })} label={t("apiType")} />
      </div>
      <LabeledField label={t("providerApiKeyOverride")} field="apiKey" help={t("providerApiKeyOverrideHelp")}>
        <input value={value.apiKey ?? ""} onChange={(event) => onChange({ ...value, apiKey: event.target.value })} />
      </LabeledField>
      <Checkbox checked={value.authHeader ?? false} onChange={(authHeader) => onChange({ ...value, authHeader })} label={t("authHeader")} help={t("authHeaderHelp")} />
      <HeadersEditor value={value.headers ?? []} onChange={(headers) => onChange({ ...value, headers })} error={fieldError(errors.headers, t)} t={t} />
      <CompatForm value={value.compat ?? {}} onChange={(compat) => onChange({ ...value, compat })} t={t} />
    </div>
  );
}

function OfficialModelSelector({
  provider,
  piModels,
  loading,
  search,
  onSearch,
  onToggle,
  onEdit,
  onRemove,
  t,
}: {
  provider: Extract<Provider, { kind: "official" }>;
  piModels: PiModelInfo[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onToggle: (modelId: string, checked: boolean) => void;
  onEdit: (model: ModelConfig, index: number) => void;
  onRemove: (model: ModelConfig) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const providerModels = piModels.filter((model) => model.provider === provider.providerId);
  const remoteIds = new Set(providerModels.map((model) => model.id));
  const localOnlyModels = provider.models.filter((model) => !remoteIds.has(model.id));
  const enabled = new Set(provider.models.map((model) => model.id));
  const filtered = providerModels.filter((model) => model.id.toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="grid gap-3 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="editor-grid grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input value={search} aria-label={t("searchModels")} placeholder={t("searchModels")} onChange={(event) => onSearch(event.target.value)} />
        <span className="muted self-center">{loading ? t("running") : `${filtered.length}/${providerModels.length}`}</span>
      </div>
      <div className="model-list">
        {!loading && providerModels.length === 0 ? (
          <div className="empty-state">{t("noAvailablePiModels")}</div>
        ) : null}
        {filtered.map((model) => {
          const localIndex = provider.models.findIndex((item) => item.id === model.id);
          const local = provider.models[localIndex] ?? { ...createModel(model.id), source: "builtin" as const };
          return (
            <div key={model.id} className="model-row">
              <label className="model-check">
                <input className="w-auto" type="checkbox" checked={enabled.has(model.id)} onChange={(event) => onToggle(model.id, event.target.checked)} />
                <span className="model-id">{model.id}</span>
              </label>
              <span className="model-meta">{model.context} / {model.maxOut} / {model.thinking ? t("thinking") : t("noThinking")} / {model.images ? t("images") : t("textOnly")}</span>
              <button type="button" className="icon-button" title={t("edit")} onClick={() => onEdit(local, localIndex >= 0 ? localIndex : provider.models.length)} disabled={!enabled.has(model.id)}>
                <Settings2 size={15} />
              </button>
            </div>
          );
        })}
        {localOnlyModels.map((model) => {
          const index = provider.models.findIndex((item) => item.id === model.id);
          return (
            <div key={model.id} className="model-row">
              <label className="model-check">
                <input className="w-auto" type="checkbox" checked onChange={(event) => !event.target.checked && onRemove(model)} />
                <span className="model-id">{model.id}</span>
              </label>
              <span className="model-meta">{t("manualModel")}</span>
              <button type="button" className="icon-button" title={t("edit")} onClick={() => onEdit(model, index)}>
                <Settings2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CustomModelSelector({
  provider,
  candidateModels,
  selectedCandidates,
  search,
  fetching,
  onSearch,
  onSelect,
  onAddSelected,
  onEdit,
  onRemove,
  t,
}: {
  provider: Extract<Provider, { kind: "custom" }>;
  candidateModels: string[];
  selectedCandidates: Set<string>;
  search: string;
  fetching: boolean;
  onSearch: (value: string) => void;
  onSelect: (value: Set<string>) => void;
  onAddSelected: () => void;
  onEdit: (model: ModelConfig, index: number) => void;
  onRemove: (model: ModelConfig) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <div className="grid gap-3">
      {(candidateModels.length > 0 || fetching) ? (
        <section className="grid gap-3 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <input value={search} aria-label={t("searchModels")} placeholder={t("searchModels")} onChange={(event) => onSearch(event.target.value)} />
          <div className="grid max-h-56 gap-2 overflow-auto">
            {candidateModels
              .filter((model) => model.toLowerCase().includes(search.toLowerCase()))
              .map((model) => (
                <label key={model} className="flex items-center gap-2 rounded-md border px-2 py-2" style={{ borderColor: "var(--border)" }}>
                  <input
                    className="w-auto"
                    type="checkbox"
                    checked={selectedCandidates.has(model)}
                    onChange={(event) => {
                      const next = new Set(selectedCandidates);
                      if (event.target.checked) next.add(model);
                      else next.delete(model);
                      onSelect(next);
                    }}
                  />
                  <span className="model-id">{model}</span>
                </label>
              ))}
          </div>
          <button type="button" onClick={onAddSelected} disabled={selectedCandidates.size === 0}>
            {t("addSelected")}
          </button>
        </section>
      ) : null}
      <section className="grid gap-2 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <SectionTitle>{t("enabledModels")}</SectionTitle>
        {provider.models.map((model, index) => (
          <div key={model.id} className="model-row">
            <span className="model-id">{model.id}</span>
            <span className="model-meta">{model.name || model.api || ""}</span>
            <button type="button" className="icon-button" title={t("edit")} onClick={() => onEdit(model, index)}>
              <Settings2 size={15} />
            </button>
            <button type="button" className="danger" onClick={() => onRemove(model)}>
              {t("remove")}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function ModelConfigForm({
  id,
  draft,
  providerKind,
  onChange,
  t,
}: {
  id?: string;
  draft: ModelConfig;
  providerKind: Provider["kind"];
  onChange: (model: ModelConfig) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const updateModel = (model: ModelConfig) => {
    onChange(providerKind === "custom" ? { ...model, overrideBuiltIn: false } : model);
  };
  return (
    <div className="grid gap-4">
      <h3 id={id} className="m-0 text-base font-semibold">{t("modelConfig")}</h3>
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Field label={t("modelId")} required>
          <input value={draft.id} onChange={(event) => updateModel({ ...draft, id: event.target.value })} />
        </Field>
        <Field label={t("modelName")}>
          <input value={draft.name ?? ""} onChange={(event) => updateModel({ ...draft, name: event.target.value })} />
        </Field>
        <ApiSelect value={draft.api ?? ""} onChange={(api) => updateModel({ ...draft, api })} label={t("apiType")} />
        <Field label={t("source")}>
          <Select
            value={draft.source ?? "custom"}
            aria-label={t("source")}
            onChange={(value) => updateModel({ ...draft, source: value as ModelConfig["source"] })}
            options={[
              { value: "custom", label: t("customModel") },
              { value: "builtin", label: t("builtinModel") },
            ]}
          />
        </Field>
      </div>
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Checkbox checked={draft.reasoning ?? false} onChange={(reasoning) => updateModel({ ...draft, reasoning })} label={t("reasoning")} />
        {providerKind === "official" ? (
          <Checkbox checked={draft.overrideBuiltIn ?? false} onChange={(overrideBuiltIn) => updateModel({ ...draft, overrideBuiltIn })} label={t("overrideBuiltIn")} help={t("overrideBuiltInHelp")} />
        ) : null}
        <Checkbox checked={(draft.input ?? ["text"]).includes("image")} onChange={(checked) => updateModel({ ...draft, input: checked ? ["text", "image"] : ["text"] })} label={t("imageInput")} />
      </div>
      <div className="editor-grid grid grid-cols-2 gap-4">
        <NumberField label={t("contextWindow")} value={draft.contextWindow} onChange={(contextWindow) => updateModel({ ...draft, contextWindow })} />
        <NumberField label={t("maxTokens")} value={draft.maxTokens} onChange={(maxTokens) => updateModel({ ...draft, maxTokens })} />
      </div>
      <details className="advanced-panel">
        <summary><SummaryHelp label={t("cost")} help={t("costHelp")} /></summary>
        <div className="editor-grid grid grid-cols-4 gap-3 pt-3">
          <NumberField label={t("costInput")} field="cost.input" value={draft.cost?.input} onChange={(input) => updateModel({ ...draft, cost: { ...draft.cost, input } })} />
          <NumberField label={t("costOutput")} field="cost.output" value={draft.cost?.output} onChange={(output) => updateModel({ ...draft, cost: { ...draft.cost, output } })} />
          <NumberField label={t("costCacheRead")} field="cost.cacheRead" value={draft.cost?.cacheRead} onChange={(cacheRead) => updateModel({ ...draft, cost: { ...draft.cost, cacheRead } })} />
          <NumberField label={t("costCacheWrite")} field="cost.cacheWrite" value={draft.cost?.cacheWrite} onChange={(cacheWrite) => updateModel({ ...draft, cost: { ...draft.cost, cacheWrite } })} />
        </div>
      </details>
      <details className="advanced-panel">
        <summary><SummaryHelp label={t("modelOverrides")} help={t("modelOverridesHelp")} /></summary>
        <div className="grid gap-4 pt-3">
          <HeadersEditor value={draft.headers ?? []} onChange={(headers) => updateModel({ ...draft, headers })} t={t} />
          <ThinkingLevelMapEditor value={draft.thinkingLevelMap ?? {}} onChange={(thinkingLevelMap) => updateModel({ ...draft, thinkingLevelMap })} t={t} />
          <CompatForm value={draft.compat ?? {}} onChange={(compat) => updateModel({ ...draft, compat })} t={t} />
        </div>
      </details>
    </div>
  );
}

function ApiSelect({ value, onChange, label, error, required }: { value: string; onChange: (value: string) => void; label: string; error?: string; required?: boolean }) {
  return (
    <Field label={label} error={error} required={required}>
      <input list="api-presets" value={value} onChange={(event) => onChange(event.target.value)} />
      <datalist id="api-presets">
        {API_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>
    </Field>
  );
}

function Checkbox({ checked, onChange, label, help }: { checked: boolean; onChange: (checked: boolean) => void; label: string; help?: string }) {
  return (
    <label className="checkbox-row">
      <input className="w-auto" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}{help ? <InlineHelp help={help} /> : null}</span>
    </label>
  );
}

function NumberField({ label, field, value, onChange }: { label: string; field?: string; value?: number; onChange: (value: number | undefined) => void }) {
  return (
    <LabeledField label={label} field={field}>
      <input type="number" min="0" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
    </LabeledField>
  );
}

function HeadersEditor({
  value,
  onChange,
  error,
  t,
}: {
  value: HeaderEntry[];
  onChange: (value: HeaderEntry[]) => void;
  error?: string;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>{t("headers")}</SectionTitle>
        <button type="button" onClick={() => onChange([...value, { key: "", value: "" }])}>
          {t("addHeader")}
        </button>
      </div>
      {error ? <div className="field-error">{error}</div> : null}
      {value.map((header, index) => (
        <div key={index} className="editor-grid grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <input aria-label="header name" value={header.key} placeholder="header" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
          <input aria-label="header value" value={header.value} placeholder="value" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
          <button type="button" className="danger" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
            {t("remove")}
          </button>
        </div>
      ))}
    </section>
  );
}

function ThinkingLevelMapEditor({
  value,
  onChange,
  t,
}: {
  value: ModelConfig["thinkingLevelMap"];
  onChange: (value: ModelConfig["thinkingLevelMap"]) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <details className="advanced-panel">
      <summary><SummaryHelp label={t("thinkingLevelMap")} help={t("thinkingLevelMapHelp")} /></summary>
      <div className="grid gap-2 pt-3">
        {THINKING_LEVELS.map((level) => (
          <div key={level} className="editor-grid grid grid-cols-[120px_150px_minmax(0,1fr)] gap-2">
            <span className="self-center model-id">{level}</span>
            <Select
              aria-label={`${level} mapping`}
              value={value?.[level] === undefined ? "default" : value[level] === null ? "unsupported" : "custom"}
              onChange={(selected) => {
                const next = { ...(value ?? {}) };
                if (selected === "default") delete next[level];
                if (selected === "unsupported") next[level] = null;
                if (selected === "custom") next[level] = "";
                onChange(next);
              }}
              options={[
                { value: "default", label: t("defaultValue") },
                { value: "unsupported", label: t("unsupported") },
                { value: "custom", label: t("customValue") },
              ]}
            />
            <input
              aria-label={`${level} custom value`}
              value={typeof value?.[level] === "string" ? value[level] ?? "" : ""}
              disabled={typeof value?.[level] !== "string"}
              onChange={(event) => onChange({ ...(value ?? {}), [level]: event.target.value })}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

function CompatForm({ value, onChange, t }: { value: CompatConfig; onChange: (value: CompatConfig) => void; t: ReturnType<typeof createTranslator> }) {
  return (
    <details className="advanced-panel">
      <summary><SummaryHelp label={t("compat")} help={t("compatHelp")} /></summary>
      <div className="grid gap-4 pt-3">
        <div className="editor-grid grid grid-cols-3 gap-3">
          <TriStateBool label={t("compatSupportsStore")} field="supportsStore" help={t("compatSupportsStoreHelp")} value={value.supportsStore} onChange={(supportsStore) => onChange({ ...value, supportsStore })} />
          <TriStateBool label={t("compatDeveloperRole")} field="supportsDeveloperRole" help={t("compatDeveloperRoleHelp")} value={value.supportsDeveloperRole} onChange={(supportsDeveloperRole) => onChange({ ...value, supportsDeveloperRole })} />
          <TriStateBool label={t("compatReasoningEffort")} field="supportsReasoningEffort" help={t("compatReasoningEffortHelp")} value={value.supportsReasoningEffort} onChange={(supportsReasoningEffort) => onChange({ ...value, supportsReasoningEffort })} />
          <TriStateBool label={t("compatUsageStreaming")} field="supportsUsageInStreaming" help={t("compatUsageStreamingHelp")} value={value.supportsUsageInStreaming} onChange={(supportsUsageInStreaming) => onChange({ ...value, supportsUsageInStreaming })} />
          <TriStateBool label={t("compatToolResultName")} field="requiresToolResultName" help={t("compatToolResultNameHelp")} value={value.requiresToolResultName} onChange={(requiresToolResultName) => onChange({ ...value, requiresToolResultName })} />
          <TriStateBool label={t("compatAssistantAfterTool")} field="requiresAssistantAfterToolResult" help={t("compatAssistantAfterToolHelp")} value={value.requiresAssistantAfterToolResult} onChange={(requiresAssistantAfterToolResult) => onChange({ ...value, requiresAssistantAfterToolResult })} />
          <TriStateBool label={t("compatThinkingAsText")} field="requiresThinkingAsText" help={t("compatThinkingAsTextHelp")} value={value.requiresThinkingAsText} onChange={(requiresThinkingAsText) => onChange({ ...value, requiresThinkingAsText })} />
          <TriStateBool label={t("compatReasoningContent")} field="requiresReasoningContentOnAssistantMessages" help={t("compatReasoningContentHelp")} value={value.requiresReasoningContentOnAssistantMessages} onChange={(requiresReasoningContentOnAssistantMessages) => onChange({ ...value, requiresReasoningContentOnAssistantMessages })} />
          <TriStateBool label={t("compatZaiToolStream")} field="zaiToolStream" help={t("compatZaiToolStreamHelp")} value={value.zaiToolStream} onChange={(zaiToolStream) => onChange({ ...value, zaiToolStream })} />
          <TriStateBool label={t("compatStrictMode")} field="supportsStrictMode" help={t("compatStrictModeHelp")} value={value.supportsStrictMode} onChange={(supportsStrictMode) => onChange({ ...value, supportsStrictMode })} />
          <TriStateBool label={t("compatSessionAffinity")} field="sendSessionAffinityHeaders" help={t("compatSessionAffinityHelp")} value={value.sendSessionAffinityHeaders} onChange={(sendSessionAffinityHeaders) => onChange({ ...value, sendSessionAffinityHeaders })} />
          <TriStateBool label={t("compatLongCache")} field="supportsLongCacheRetention" help={t("compatLongCacheHelp")} value={value.supportsLongCacheRetention} onChange={(supportsLongCacheRetention) => onChange({ ...value, supportsLongCacheRetention })} />
          <TriStateBool label={t("compatSessionId")} field="sendSessionIdHeader" help={t("compatSessionIdHelp")} value={value.sendSessionIdHeader} onChange={(sendSessionIdHeader) => onChange({ ...value, sendSessionIdHeader })} />
          <TriStateBool label={t("compatEagerToolInput")} field="supportsEagerToolInputStreaming" help={t("compatEagerToolInputHelp")} value={value.supportsEagerToolInputStreaming} onChange={(supportsEagerToolInputStreaming) => onChange({ ...value, supportsEagerToolInputStreaming })} />
          <TriStateBool label={t("compatCacheControlTools")} field="supportsCacheControlOnTools" help={t("compatCacheControlToolsHelp")} value={value.supportsCacheControlOnTools} onChange={(supportsCacheControlOnTools) => onChange({ ...value, supportsCacheControlOnTools })} />
          <TriStateBool label={t("compatTemperature")} field="supportsTemperature" help={t("compatTemperatureHelp")} value={value.supportsTemperature} onChange={(supportsTemperature) => onChange({ ...value, supportsTemperature })} />
          <TriStateBool label={t("compatAdaptiveThinking")} field="forceAdaptiveThinking" help={t("compatAdaptiveThinkingHelp")} value={value.forceAdaptiveThinking} onChange={(forceAdaptiveThinking) => onChange({ ...value, forceAdaptiveThinking })} />
          <TriStateBool label={t("compatEmptySignature")} field="allowEmptySignature" help={t("compatEmptySignatureHelp")} value={value.allowEmptySignature} onChange={(allowEmptySignature) => onChange({ ...value, allowEmptySignature })} />
        </div>
        <div className="editor-grid grid grid-cols-3 gap-3">
          <LabeledField label={t("compatMaxTokensField")} field="maxTokensField" help={t("compatMaxTokensFieldHelp")}>
            <Select
              value={value.maxTokensField ?? ""}
              aria-label={t("compatMaxTokensField")}
              onChange={(selected) => onChange({ ...value, maxTokensField: selected as CompatConfig["maxTokensField"] })}
              options={[
                { value: "", label: t("defaultValue") },
                { value: "max_completion_tokens", label: "max_completion_tokens" },
                { value: "max_tokens", label: "max_tokens" },
              ]}
            />
          </LabeledField>
          <LabeledField label={t("compatThinkingFormat")} field="thinkingFormat" help={t("compatThinkingFormatHelp")}>
            <input value={value.thinkingFormat ?? ""} onChange={(event) => onChange({ ...value, thinkingFormat: event.target.value as CompatConfig["thinkingFormat"] })} />
          </LabeledField>
          <LabeledField label={t("compatCacheControlFormat")} field="cacheControlFormat" help={t("compatCacheControlFormatHelp")}>
            <Select
              value={value.cacheControlFormat ?? ""}
              aria-label={t("compatCacheControlFormat")}
              onChange={(selected) => onChange({ ...value, cacheControlFormat: selected as CompatConfig["cacheControlFormat"] })}
              options={[
                { value: "", label: t("defaultValue") },
                { value: "anthropic", label: "anthropic" },
              ]}
            />
          </LabeledField>
        </div>
        <RoutingForm value={value} onChange={onChange} t={t} />
      </div>
    </details>
  );
}

function TriStateBool({ label, field, help, value, onChange }: { label: string; field?: string; help?: string; value?: boolean; onChange: (value: boolean | undefined) => void }) {
  return (
    <LabeledField label={label} field={field} help={help}>
      <Select
        value={value === undefined ? "" : value ? "true" : "false"}
        aria-label={label}
        onChange={(selected) => onChange(selected === "" ? undefined : selected === "true")}
        options={[
          { value: "", label: "default" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
      />
    </LabeledField>
  );
}

function RoutingForm({ value, onChange, t }: { value: CompatConfig; onChange: (value: CompatConfig) => void; t: ReturnType<typeof createTranslator> }) {
  const openRouterRouting = value.openRouterRouting ?? {};
  const vercelGatewayRouting = value.vercelGatewayRouting ?? {};
  return (
    <details className="advanced-panel">
      <summary><SummaryHelp label={t("routing")} help={t("routingHelp")} /></summary>
      <div className="grid gap-4 pt-3">
        <SectionTitle>OpenRouter</SectionTitle>
        <div className="editor-grid grid grid-cols-3 gap-3">
          <TriStateBool label={t("routeFallbacks")} field="allow_fallbacks" help={t("routeFallbacksHelp")} value={openRouterRouting.allowFallbacks} onChange={(allowFallbacks) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, allowFallbacks } })} />
          <TriStateBool label={t("routeRequireParameters")} field="require_parameters" help={t("routeRequireParametersHelp")} value={openRouterRouting.requireParameters} onChange={(requireParameters) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, requireParameters } })} />
          <TriStateBool label={t("routeZdr")} field="zdr" help={t("routeZdrHelp")} value={openRouterRouting.zdr} onChange={(zdr) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, zdr } })} />
          <TriStateBool label={t("routeDistillable")} field="enforce_distillable_text" help={t("routeDistillableHelp")} value={openRouterRouting.enforceDistillableText} onChange={(enforceDistillableText) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, enforceDistillableText } })} />
          <LabeledField label={t("routeDataCollection")} field="data_collection" help={t("routeDataCollectionHelp")}>
            <Select
              value={openRouterRouting.dataCollection ?? ""}
              aria-label={t("routeDataCollection")}
              onChange={(selected) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, dataCollection: selected as "allow" | "deny" | "" } })}
              options={[
                { value: "", label: t("defaultValue") },
                { value: "allow", label: "allow" },
                { value: "deny", label: "deny" },
              ]}
            />
          </LabeledField>
          <LabeledField label={t("routeSort")} field="sort.by" help={t("routeSortHelp")}>
            <input value={openRouterRouting.sortBy ?? ""} onChange={(event) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, sortBy: event.target.value } })} />
          </LabeledField>
        </div>
        <div className="editor-grid grid grid-cols-3 gap-3">
          <StringListField label={t("routeOrder")} field="order" help={t("routeOrderHelp")} value={openRouterRouting.order ?? []} onChange={(order) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, order } })} />
          <StringListField label={t("routeOnly")} field="only" help={t("routeOnlyHelp")} value={openRouterRouting.only ?? []} onChange={(only) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, only } })} />
          <StringListField label={t("routeIgnore")} field="ignore" help={t("routeIgnoreHelp")} value={openRouterRouting.ignore ?? []} onChange={(ignore) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, ignore } })} />
          <StringListField label={t("routeQuantizations")} field="quantizations" help={t("routeQuantizationsHelp")} value={openRouterRouting.quantizations ?? []} onChange={(quantizations) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, quantizations } })} />
        </div>
        <SectionTitle>Vercel AI Gateway</SectionTitle>
        <div className="editor-grid grid grid-cols-2 gap-3">
          <StringListField label={t("routeOnly")} field="only" help={t("routeOnlyHelp")} value={vercelGatewayRouting.only ?? []} onChange={(only) => onChange({ ...value, vercelGatewayRouting: { ...vercelGatewayRouting, only } })} />
          <StringListField label={t("routeOrder")} field="order" help={t("routeOrderHelp")} value={vercelGatewayRouting.order ?? []} onChange={(order) => onChange({ ...value, vercelGatewayRouting: { ...vercelGatewayRouting, order } })} />
        </div>
      </div>
    </details>
  );
}

function StringListField({ label, field, help, value, onChange }: { label: string; field?: string; help?: string; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <LabeledField label={label} field={field} help={help}>
      <input value={value.join(", ")} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
    </LabeledField>
  );
}

function providerLabel(provider: Provider) {
  if (provider.kind === "official") return OFFICIAL_PROVIDER_LABELS[provider.providerId] ?? provider.providerId;
  return piProviderId(provider);
}

function isOfficialProviderId(value: string): value is OfficialProviderId {
  return (OFFICIAL_PROVIDER_IDS as readonly string[]).includes(value);
}

function accountProviderLabel(providerId: string, providers: Provider[]) {
  if (isOfficialProviderId(providerId)) return OFFICIAL_PROVIDER_LABELS[providerId] ?? providerId;
  const provider = providers.find((item) => piProviderId(item) === providerId || item.id === providerId);
  return provider?.name || providerId;
}

function accountProviderFilterOptions(accounts: AuthAccount[], providers: Provider[]) {
  const seen = new Set<string>();
  return accounts
    .map((account) => account.providerId)
    .filter((providerId) => {
      if (seen.has(providerId)) return false;
      seen.add(providerId);
      return true;
    })
    .sort((left, right) => accountProviderLabel(left, providers).localeCompare(accountProviderLabel(right, providers)))
    .map((id) => ({ id, label: accountProviderLabel(id, providers) }));
}

function officialProviderBaseUrl(providerId: OfficialProviderId) {
  return OFFICIAL_PROVIDER_BASE_URLS[providerId] ?? "";
}

function compareAccountsForDisplay(left: AuthAccount, right: AuthAccount) {
  if (left.activeInPi !== right.activeInPi) return left.activeInPi ? -1 : 1;
  const provider = left.providerId.localeCompare(right.providerId);
  if (provider !== 0) return provider;
  const label = left.label.localeCompare(right.label);
  if (label !== 0) return label;
  return left.createdAt.localeCompare(right.createdAt);
}

function accountIdentityText(account: AuthAccount) {
  return (account.identity ?? [])
    .slice()
    .sort((left, right) => accountIdentityRank(left.field) - accountIdentityRank(right.field))
    .slice(0, 3)
    .map((item) => `${accountIdentityLabel(item.field)}: ${item.value}`)
    .join(" / ");
}

function accountOptionLabel(account: AuthAccount, t: ReturnType<typeof createTranslator>) {
  return [
    account.label,
    accountIdentityText(account),
    account.kind === "oauth" ? "OAuth" : "API Key",
    account.activeInPi ? t("activeInPi") : t("saved"),
  ]
    .filter(Boolean)
    .join(" / ");
}

function accountIdentityRank(field: string) {
  const normalized = field.toLowerCase();
  if (normalized.includes("email") || normalized.includes("mail")) return 0;
  if (normalized.includes("chatgptaccountid")) return 1;
  if (normalized.endsWith("account.id") || normalized.includes("accountid")) return 2;
  if (normalized.includes("chatgptuserid")) return 3;
  if (normalized.endsWith(".id") || normalized === "id") return 4;
  if (normalized.endsWith(".sub") || normalized === "sub" || normalized.includes("subject")) return 5;
  if (normalized.includes("authprovider")) return 6;
  return 20;
}

function accountIdentityLabel(field: string) {
  const normalized = field.toLowerCase();
  if (normalized.includes("email") || normalized.includes("mail")) return "Email";
  if (normalized.includes("chatgptaccountid") || normalized.endsWith("account.id") || normalized.includes("accountid")) return "Account";
  if (normalized.includes("chatgptuserid") || normalized.endsWith(".id") || normalized === "id") return "User";
  if (normalized.endsWith(".sub") || normalized === "sub" || normalized.includes("subject")) return "Subject";
  if (normalized.includes("authprovider")) return "Login";
  return field;
}

function fieldError(code: string | undefined, t: ReturnType<typeof createTranslator>) {
  if (!code) return "";
  if (code === "REQUIRED") return t("required");
  if (code === "MODEL_REQUIRED") return t("modelRequired");
  if (code === "DEFAULT_MODEL_MISSING") return t("defaultModelMissing");
  if (code === "RESERVED") return t("reservedProvider");
  if (code === "DUPLICATE_MODEL") return t("duplicateModel");
  if (code === "MODEL_ID_REQUIRED") return t("modelIdRequired");
  if (code === "INVALID_NUMBER") return t("invalidNumber");
  if (code === "INVALID_HEADER") return t("invalidHeader");
  return code;
}

function withValidDefaultModel<T extends Provider>(provider: T): T {
  const enabled = enabledModels(provider);
  const defaultModelId = enabled.some((model) => model.id === provider.defaultModelId)
    ? provider.defaultModelId
    : enabled[0]?.id ?? "";
  return { ...provider, defaultModelId };
}

function normalizeModelDraft(model: ModelConfig): ModelConfig {
  return {
    ...model,
    id: model.id.trim(),
    name: emptyToUndefined(model.name),
    api: emptyToUndefined(model.api),
    headers: (model.headers ?? []).filter((header) => header.key.trim()),
  };
}

function emptyToUndefined<T extends string>(value: T | undefined) {
  const trimmed = value?.trim();
  return trimmed ? (trimmed as T) : undefined;
}

function formatError(err: unknown, t: ReturnType<typeof createTranslator>) {
  const error = err as AppError;
  if (isPiCommandMissing(error)) {
    return `${t("piMissingTitle")}\n${t("piMissingShort")}`;
  }
  const parts = [error.message ?? String(err)];
  if (error.details) parts.push(error.details);
  if (error.failedFile) parts.push(`${t("failedFile")}: ${error.failedFile}`);
  if (error.writtenFiles?.length) parts.push(`${t("writtenFiles")}: ${error.writtenFiles.join(", ")}`);
  if (error.failedFile) parts.push(t("applyFailureHint"));
  return parts.filter(Boolean).join("\n");
}

function isPiCommandMissing(error: unknown) {
  const code = (error as AppError | undefined)?.code;
  return code === "PI_COMMAND_NOT_FOUND" || code === "NODE_COMMAND_NOT_FOUND";
}

export default App;
