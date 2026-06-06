import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  CirclePlay,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  applyAuthAccount,
  applyProviderToPi,
  createApiKeyAccount,
  deleteAuthAccount,
  duplicateAuthAccount,
  fetchCustomProviderModels,
  importPiAuthAccount,
  loginOfficialProviderOAuth,
  loadAuthAccounts,
  listPiModels,
  loadAppConfig,
  renameAuthAccount,
  saveAppConfig,
  submitOAuthManualCode,
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
type AccountProviderFilter = "all" | OfficialProviderId;

type ModelDraft = {
  model: ModelConfig;
  index?: number;
};

const EMPTY_MODEL_DRAFT: ModelDraft = { model: createModel() };
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function App() {
  const [config, setConfig] = useState<AppConfig>(() => normalizeConfig({ schemaVersion: 3, theme: "system", providers: [] }));
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("providers");
  const [selectedAccountId, setSelectedAccountId] = useState<string>();
  const [accountProviderFilter, setAccountProviderFilter] = useState<AccountProviderFilter>("all");
  const [newAccountProviderId, setNewAccountProviderId] = useState<OfficialProviderId>("openai-codex");
  const [newAccountLabel, setNewAccountLabel] = useState("");
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
  const openedOAuthUrlsRef = useRef<Set<string>>(new Set());
  const language = config.language ?? systemLanguage();
  const t = useMemo(() => createTranslator(language), [language]);
  const activeProvider = config.providers.find((provider) => provider.id === config.activeProviderId);
  const filteredAccounts = useMemo(
    () =>
      (accountProviderFilter === "all" ? accounts : accounts.filter((account) => account.providerId === accountProviderFilter))
        .slice()
        .sort(compareAccountsForDisplay),
    [accounts, accountProviderFilter],
  );
  const selectedAccount = filteredAccounts.find((account) => account.id === selectedAccountId) ?? filteredAccounts[0];
  const errors = validationErrors(activeProvider);

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
      const urlToOpen = event.payload.type === "auth" ? event.payload.url : event.payload.type === "deviceCode" ? event.payload.verificationUri : undefined;
      if (urlToOpen && !openedOAuthUrlsRef.current.has(urlToOpen)) {
        openedOAuthUrlsRef.current.add(urlToOpen);
        openUrl(urlToOpen).catch((err) => showError(err));
      }
      if (event.payload.type === "manualCode") {
        const code = window.prompt(event.payload.message ?? t("oauthManualCodePrompt"))?.trim();
        if (code) {
          submitOAuthManualCode(event.payload.loginId, code).catch((err) => showError(err));
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
  }

  function updateActiveProvider(provider: Provider) {
    updateConfig({
      ...config,
      providers: config.providers.map((item) => (item.id === provider.id ? provider : item)),
    });
  }

  function manageAccountsForProvider(providerId: OfficialProviderId) {
    setNewAccountProviderId(providerId);
    setAccountProviderFilter(providerId);
    setActiveTab("accounts");
  }

  function focusAccount(account: AuthAccount) {
    setAccountProviderFilter(account.providerId);
    setNewAccountProviderId(account.providerId);
    setSelectedAccountId(account.id);
  }

  function addProvider() {
    const provider = createCustomProvider();
    updateConfig({
      ...config,
      activeProviderId: provider.id,
      providers: [...config.providers, provider],
    });
    setShowKey(false);
  }

  function duplicateProvider() {
    if (!activeProvider) return;
    const clone: Provider = {
      ...structuredClone(activeProvider),
      id: `provider_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(6, "0").slice(0, 6)}`,
      name: `${activeProvider.name} Copy`,
    };
    updateConfig({ ...config, activeProviderId: clone.id, providers: [...config.providers, clone] });
  }

  function deleteProvider() {
    if (!activeProvider) return;
    const providers = config.providers.filter((provider) => provider.id !== activeProvider.id);
    updateConfig({ ...config, activeProviderId: providers[0]?.id, providers });
    deleteDialogRef.current?.close();
  }

  async function saveCurrentConfig(nextConfig = config) {
    const provider = nextConfig.providers.find((item) => item.id === nextConfig.activeProviderId);
    if (Object.keys(validationErrors(provider)).length > 0) {
      showToast("error", t("validationFailed"));
      return false;
    }
    try {
      await saveAppConfig(nextConfig);
      showToast("success", t("saveSuccess"));
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }

  async function applyCurrentProvider() {
    if (!activeProvider) return;
    if (Object.keys(errors).length > 0) {
      showToast("error", t("validationFailed"));
      return;
    }
    try {
      await applyProviderToPi(config, activeProvider.id);
      showToast("success", t("applySuccess"));
      await refreshAccounts();
    } catch (err) {
      showError(err);
    }
  }

  async function testCurrentProvider() {
    if (!activeProvider) return;
    const saved = await saveCurrentConfig();
    if (!saved) return;
    setTestState({ status: "running", output: 'pi -p "ping"\n' });
    try {
      const result = await runTestProvider(config, activeProvider.id);
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
    if (oauthState.running) return;
    openedOAuthUrlsRef.current.clear();
    setOAuthState({ providerId: provider.providerId, running: true, events: [] });
    try {
      const label = `${OFFICIAL_PROVIDER_LABELS[provider.providerId]} OAuth`;
      const result = await loginOfficialProviderOAuth(provider.providerId, label);
      await refreshAccounts();
      const nextProvider = { ...provider, authMode: "account" as const, authAccountId: result.account.id };
      const nextConfig = {
        ...config,
        providers: config.providers.map((item) => (item.id === provider.id ? nextProvider : item)),
      };
      updateConfig(nextConfig);
      await applyAuthAccount(result.account.id);
      await refreshAccounts();
      showToast("success", t("oauthLoginSuccess"));
    } catch (err) {
      showError(err);
    } finally {
      setOAuthState((state) => ({ ...state, running: false }));
    }
  }

  async function addOAuthAccount() {
    if (oauthState.running) return;
    openedOAuthUrlsRef.current.clear();
    setOAuthState({ providerId: newAccountProviderId, running: true, events: [] });
    setAccountBusy(true);
    try {
      const result = await loginOfficialProviderOAuth(newAccountProviderId, newAccountLabel);
      const applied = await applyAuthAccount(result.account.id);
      await refreshAccounts();
      focusAccount(applied);
      setNewAccountLabel("");
      showToast("success", t("accountSavedAndApplied"));
    } catch (err) {
      showError(err);
    } finally {
      setOAuthState((state) => ({ ...state, running: false }));
      setAccountBusy(false);
    }
  }

  async function addApiKeyAccount() {
    if (!newAccountApiKey.trim()) {
      showToast("error", t("required"));
      return;
    }
    setAccountBusy(true);
    try {
      const account = await createApiKeyAccount(newAccountProviderId, newAccountLabel, newAccountApiKey);
      const applied = await applyAuthAccount(account.id);
      await refreshAccounts();
      focusAccount(applied);
      setNewAccountLabel("");
      setNewAccountApiKey("");
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
      const account = await createApiKeyAccount(provider.providerId, label, provider.apiKey);
      await refreshAccounts();
      const nextProvider = { ...provider, authMode: "account" as const, authAccountId: account.id, apiKey: "" };
      const nextConfig = {
        ...config,
        providers: config.providers.map((item) => (item.id === provider.id ? nextProvider : item)),
      };
      updateConfig(nextConfig);
      await applyAuthAccount(account.id);
      await refreshAccounts();
      showToast("success", t("providerApiKeySavedAsAccount"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function importCurrentPiAuth() {
    setAccountBusy(true);
    try {
      const account = await importPiAuthAccount(newAccountProviderId, newAccountLabel);
      await refreshAccounts();
      focusAccount(account);
      setNewAccountLabel("");
      showToast("success", t("accountSaved"));
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
      showToast("success", t("accountApplied"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
    }
  }

  async function renameSelectedAccount(account: AuthAccount) {
    const label = window.prompt(t("renameAccount"), account.label)?.trim();
    if (!label) return;
    setAccountBusy(true);
    try {
      const updated = await renameAuthAccount(account.id, label);
      await refreshAccounts();
      setSelectedAccountId(updated.id);
      showToast("success", t("accountSaved"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
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
    const message = account.activeInPi
      ? `${t("deleteActiveAccountConfirm")} "${account.label}"?`
      : `${t("deleteAccountConfirm")} "${account.label}"?`;
    if (!window.confirm(message)) return;
    setAccountBusy(true);
    try {
      await deleteAuthAccount(account.id);
      const loaded = await loadAppConfig();
      setConfig(normalizeConfig(loaded.config));
      setPaths(loaded.resolvedPaths);
      await refreshAccounts();
      showToast("success", t("accountDeleted"));
    } catch (err) {
      showError(err);
    } finally {
      setAccountBusy(false);
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
    updateActiveProvider(withValidDefaultModel({ ...activeProvider, models: [...activeProvider.models, ...additions] }));
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
    updateActiveProvider(withValidDefaultModel({ ...activeProvider, models, defaultModelId: activeProvider.defaultModelId || model.id }));
    modelDialogRef.current?.close();
  }

  function removeModel(model: ModelConfig) {
    if (!activeProvider) return;
    updateActiveProvider(withValidDefaultModel({ ...activeProvider, models: activeProvider.models.filter((item) => item.id !== model.id) }));
  }

  function toggleOfficialModel(modelId: string, checked: boolean) {
    if (!activeProvider || activeProvider.kind !== "official") return;
    const models = checked
      ? [...activeProvider.models, { ...createModel(modelId), source: "builtin" as const }]
      : activeProvider.models.filter((model) => model.id !== modelId);
    updateActiveProvider(withValidDefaultModel({ ...activeProvider, models, defaultModelId: activeProvider.defaultModelId || modelId }));
  }

  function updateDefaultModel(defaultModelId: string) {
    if (!activeProvider) return;
    updateActiveProvider({ ...activeProvider, defaultModelId });
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center">{t("running")}</div>;
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto]" style={{ background: "var(--bg)" }}>
      {toast ? <Toast toast={toast} onClose={() => setToast(undefined)} /> : null}
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div>
          <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>
          <p className="muted m-0">{t("subtitle")}</p>
        </div>
        <div className="top-actions grid min-w-[330px] grid-cols-2 gap-2">
          <label>
            <span>{t("language")}</span>
            <select value={language} onChange={(event) => updateConfig({ ...config, language: event.target.value as AppConfig["language"] })}>
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            <span>{t("theme")}</span>
            <select value={config.theme} onChange={(event) => updateConfig({ ...config, theme: event.target.value as ThemeMode })}>
              <option value="system">{t("system")}</option>
              <option value="light">{t("light")}</option>
              <option value="dark">{t("dark")}</option>
            </select>
          </label>
        </div>
      </header>

      <main className="workspace grid min-h-0 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button type="button" className={activeTab === "providers" ? "primary" : ""} onClick={() => setActiveTab("providers")}>
              {t("providers")}
            </button>
            <button type="button" className={activeTab === "accounts" ? "primary" : ""} onClick={() => setActiveTab("accounts")}>
              {t("accounts")}
            </button>
          </div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">{activeTab === "providers" ? t("providers") : t("accounts")}</h2>
          </div>
          {activeTab === "providers" ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button type="button" className="flex items-center justify-center gap-2" onClick={addProvider}>
                  <Plus size={15} /> {t("newProvider")}
                </button>
                <button type="button" className="flex items-center justify-center gap-2" onClick={duplicateProvider} disabled={!activeProvider}>
                  <Copy size={15} /> {t("duplicate")}
                </button>
                <button type="button" className="danger col-span-2 flex items-center justify-center gap-2" onClick={() => deleteDialogRef.current?.showModal()} disabled={!activeProvider}>
                  <Trash2 size={15} /> {t("delete")}
                </button>
              </div>
              <div className="grid gap-2">
                {config.providers.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    className={`provider-item ${provider.id === config.activeProviderId ? "active" : ""}`}
                    onClick={() => updateConfig({ ...config, activeProviderId: provider.id })}
                  >
                    <strong>{provider.name}</strong>
                    <span className="provider-meta">
                      {provider.kind === "official" ? t("official") : t("custom")} / {providerLabel(provider)}
                    </span>
                    <span className="provider-meta">{provider.defaultModelId || t("noDefaultModel")}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              {filteredAccounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className={`provider-item ${account.id === selectedAccount?.id ? "active" : ""}`}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <strong>{account.label}</strong>
                  {accountIdentityText(account) ? <span className="provider-meta">{accountIdentityText(account)}</span> : null}
                  <span className="provider-meta">{OFFICIAL_PROVIDER_LABELS[account.providerId]} / {account.kind === "oauth" ? "OAuth" : "API Key"}</span>
                  <span className="provider-meta">{account.activeInPi ? t("activeInPi") : t("saved")}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="min-w-0 overflow-auto p-5">
          {activeTab === "accounts" ? (
            <AccountsPanel
              accounts={accounts}
              filteredAccounts={filteredAccounts}
              selectedAccount={selectedAccount}
              providerFilter={accountProviderFilter}
              providerId={newAccountProviderId}
              label={newAccountLabel}
              apiKey={newAccountApiKey}
              showApiKey={showAccountKey}
              busy={accountBusy}
              oauthState={oauthState}
              onProviderFilter={setAccountProviderFilter}
              onProviderId={setNewAccountProviderId}
              onLabel={setNewAccountLabel}
              onApiKey={setNewAccountApiKey}
              onShowApiKey={setShowAccountKey}
              onAddOAuth={addOAuthAccount}
              onAddApiKey={addApiKeyAccount}
              onImport={importCurrentPiAuth}
              onApply={applySelectedAccount}
              onRename={renameSelectedAccount}
              onDuplicate={duplicateSelectedAccount}
              onDelete={deleteSelectedAccount}
              onSelect={setSelectedAccountId}
              t={t}
            />
          ) : !activeProvider ? (
            <div className="grid min-h-[420px] place-items-center muted">{t("noProvider")}</div>
          ) : (
            <div className="grid max-w-[1040px] gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-semibold">{activeProvider.name}</h2>
                <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  {activeProvider.kind === "official" ? t("official") : t("custom")}
                </span>
              </div>

              <div className="editor-grid grid grid-cols-2 gap-4">
                <Field label={t("name")} error={fieldError(errors.name, t)} required>
                  <input value={activeProvider.name} onChange={(event) => updateActiveProvider({ ...activeProvider, name: event.target.value })} />
                </Field>
                <Field label={t("kind")}>
                  <select
                    value={activeProvider.kind}
                    onChange={(event) => {
                      const replacement = event.target.value === "official" ? createOfficialProvider() : createCustomProvider();
                      updateActiveProvider({ ...replacement, id: activeProvider.id, name: activeProvider.name });
                    }}
                  >
                    <option value="official">{t("official")}</option>
                    <option value="custom">{t("custom")}</option>
                  </select>
                </Field>
              </div>

              {activeProvider.kind === "official" ? (
                <OfficialProviderForm
                  provider={activeProvider}
                  onChange={updateActiveProvider}
                  errors={errors}
                  showKey={showKey}
                  setShowKey={setShowKey}
                  onOpenAdvanced={() => providerAdvancedDialogRef.current?.showModal()}
                  onLoginOAuth={loginOAuthProvider}
                  onSaveApiKeyAsAccount={saveProviderApiKeyAsAccount}
                  onManageAccounts={manageAccountsForProvider}
                  oauthState={oauthState}
                  accounts={accounts}
                  busy={accountBusy}
                  t={t}
                />
              ) : (
                <CustomProviderForm provider={activeProvider} onChange={updateActiveProvider} errors={errors} showKey={showKey} setShowKey={setShowKey} onOpenAdvanced={() => providerAdvancedDialogRef.current?.showModal()} t={t} />
              )}

              <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="m-0 text-base font-semibold">{t("models")}</h3>
                  <div className="flex flex-wrap gap-2">
                    {activeProvider.kind === "official" ? (
                      <button type="button" className="flex items-center gap-2" onClick={refreshPiModels} disabled={piModelsLoading}>
                        <RefreshCw size={15} /> {t("refreshPiModels")}
                      </button>
                    ) : (
                      <button type="button" className="flex items-center gap-2" onClick={fetchModels} disabled={fetching}>
                        <Download size={15} /> {t("fetchModels")}
                      </button>
                    )}
                    <button type="button" className="flex items-center gap-2" onClick={() => openAddModelDialog()}>
                      <Plus size={15} /> {t("addModel")}
                    </button>
                  </div>
                </div>
                {activeProvider.kind === "official" ? (
                  <OfficialModelSelector
                    provider={activeProvider}
                    piModels={piModels}
                    loading={piModelsLoading}
                    search={piModelSearch}
                    onSearch={setPiModelSearch}
                    onToggle={toggleOfficialModel}
                    onEdit={openEditModelDialog}
                    onRemove={removeModel}
                    t={t}
                  />
                ) : (
                  <CustomModelSelector
                    provider={activeProvider}
                    candidateModels={candidateModels}
                    selectedCandidates={selectedCandidates}
                    search={modelSearch}
                    fetching={fetching}
                    onSearch={setModelSearch}
                    onSelect={setSelectedCandidates}
                    onAddSelected={addSelectedModels}
                    onEdit={openEditModelDialog}
                    onRemove={removeModel}
                    t={t}
                  />
                )}

                <Field label={t("defaultModel")} error={fieldError(errors.models, t)} required>
                  <select value={activeProvider.defaultModelId} onChange={(event) => updateDefaultModel(event.target.value)} disabled={enabledModels(activeProvider).length === 0}>
                    {enabledModels(activeProvider).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id}
                      </option>
                    ))}
                  </select>
                </Field>
              </section>

              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="primary flex items-center gap-2" onClick={() => saveCurrentConfig()}>
                    <Save size={15} /> {t("save")}
                  </button>
                  <button type="button" className="flex items-center gap-2" onClick={applyCurrentProvider}>
                    <Check size={15} /> {t("apply")}
                  </button>
                  <button type="button" className="flex items-center gap-2" onClick={testCurrentProvider}>
                    <CirclePlay size={15} /> {t("test")}
                  </button>
                  <button type="button" onClick={() => outputDialogRef.current?.showModal()}>
                    {t("viewOutput")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <dialog ref={outputDialogRef} className="dialog model-dialog p-4">
        <button type="button" className="dialog-close icon-button" title={t("close")} onClick={() => outputDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">{t("output")}</h3>
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

      <dialog ref={deleteDialogRef} className="dialog p-4">
        <p>
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

      <dialog ref={modelDialogRef} className="dialog model-dialog p-4">
        <button type="button" className="dialog-close icon-button" title={t("close")} onClick={() => modelDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <ModelConfigForm draft={modelDraft.model} providerKind={activeProvider?.kind ?? "custom"} onChange={(model) => setModelDraft({ ...modelDraft, model })} t={t} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => modelDialogRef.current?.close()}>
            {t("cancel")}
          </button>
          <button type="button" className="primary" onClick={saveModelDraft}>
            {t("confirm")}
          </button>
        </div>
      </dialog>

      <dialog ref={providerAdvancedDialogRef} className="dialog model-dialog p-4">
        <button type="button" className="dialog-close icon-button" title={t("close")} onClick={() => providerAdvancedDialogRef.current?.close()}>
          <X size={16} />
        </button>
        <h3 className="m-0 mb-4 text-base font-semibold">{t("providerAdvanced")}</h3>
        {activeProvider?.kind === "official" ? (
          <ProviderAdvancedForm value={activeProvider.advanced ?? {}} onChange={(advanced) => updateActiveProvider({ ...activeProvider, advanced })} errors={errors} t={t} />
        ) : null}
        {activeProvider?.kind === "custom" ? (
          <div className="grid gap-4">
            <Checkbox checked={activeProvider.authHeader ?? false} onChange={(authHeader) => updateActiveProvider({ ...activeProvider, authHeader })} label={t("authHeader")} help={t("authHeaderHelp")} />
            <HeadersEditor value={activeProvider.headers ?? []} onChange={(headers) => updateActiveProvider({ ...activeProvider, headers })} t={t} />
            <CompatForm value={activeProvider.compat ?? {}} onChange={(compat) => updateActiveProvider({ ...activeProvider, compat })} t={t} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="primary" onClick={() => providerAdvancedDialogRef.current?.close()}>
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
  return <strong className="text-sm">{children}</strong>;
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
  providerFilter,
  providerId,
  label,
  apiKey,
  showApiKey,
  busy,
  oauthState,
  onProviderFilter,
  onProviderId,
  onLabel,
  onApiKey,
  onShowApiKey,
  onAddOAuth,
  onAddApiKey,
  onImport,
  onApply,
  onRename,
  onDuplicate,
  onDelete,
  onSelect,
  t,
}: {
  accounts: AuthAccount[];
  filteredAccounts: AuthAccount[];
  selectedAccount?: AuthAccount;
  providerFilter: AccountProviderFilter;
  providerId: OfficialProviderId;
  label: string;
  apiKey: string;
  showApiKey: boolean;
  busy: boolean;
  oauthState: OAuthState;
  onProviderId: (value: OfficialProviderId) => void;
  onLabel: (value: string) => void;
  onApiKey: (value: string) => void;
  onShowApiKey: (value: boolean) => void;
  onAddOAuth: () => void;
  onAddApiKey: () => void;
  onImport: () => void;
  onApply: (account: AuthAccount) => void;
  onRename: (account: AuthAccount) => void;
  onDuplicate: (account: AuthAccount) => void;
  onDelete: (account: AuthAccount) => void;
  onSelect: (accountId: string) => void;
  onProviderFilter: (value: AccountProviderFilter) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  const oauthSupported = supportsOAuthLogin(providerId);
  const codexSummary = codexAccountSummary(accounts);
  return (
    <div className="grid max-w-[1040px] gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">{t("accounts")}</h2>
        <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          {filteredAccounts.length}/{accounts.length}
        </span>
      </div>

      <section className="grid gap-4 rounded-md border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <SectionTitle>{t("addAccount")}</SectionTitle>
        <div className="editor-grid grid grid-cols-3 gap-4">
          <Field label={t("provider")}>
            <select value={providerId} onChange={(event) => onProviderId(event.target.value as OfficialProviderId)}>
              {OFFICIAL_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {OFFICIAL_PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("accountName")}>
            <input value={label} onChange={(event) => onLabel(event.target.value)} placeholder={OFFICIAL_PROVIDER_LABELS[providerId]} />
          </Field>
          <SecretField value={apiKey} onChange={onApiKey} showKey={showApiKey} setShowKey={onShowApiKey} t={t} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="flex items-center gap-2" onClick={onAddOAuth} disabled={busy || oauthState.running || !oauthSupported}>
            <Plus size={15} /> {oauthState.running && oauthState.providerId === providerId ? t("running") : t("addOAuthAccount")}
          </button>
          <button type="button" className="flex items-center gap-2" onClick={onAddApiKey} disabled={busy}>
            <Plus size={15} /> {t("addApiKeyAccount")}
          </button>
          <button type="button" className="flex items-center gap-2" onClick={onImport} disabled={busy}>
            <Download size={15} /> {t("importPiAuth")}
          </button>
        </div>
        {oauthSupported ? <div className="muted">{t("oauthMultiAccountHelp")}</div> : null}
        {oauthState.providerId === providerId && oauthState.events.length > 0 ? <OAuthEventList events={oauthState.events} t={t} /> : null}
        <CodexAccountReadiness summary={codexSummary} t={t} />
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{t("savedAccounts")}</SectionTitle>
          <label className="filter-control">
            <span>{t("accountFilter")}</span>
            <select value={providerFilter} onChange={(event) => onProviderFilter(event.target.value as AccountProviderFilter)}>
              <option value="all">{t("allAccounts")}</option>
              {OFFICIAL_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {OFFICIAL_PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filteredAccounts.length === 0 ? <div className="empty-state">{t("noAccounts")}</div> : null}
        <div className="model-list">
          {filteredAccounts.map((account) => (
            <div
              key={account.id}
              className={`account-row ${account.id === selectedAccount?.id ? "active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(account.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(account.id);
                }
              }}
            >
              <strong>{account.label}</strong>
              <span className="model-id">{accountIdentityText(account) || account.providerId}</span>
              <span className="model-meta">{account.kind === "oauth" ? "OAuth" : "API Key"}</span>
              <span className="model-meta">{account.activeInPi ? t("activeInPi") : t("saved")}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onApply(account);
                }}
                disabled={busy}
              >
                {t("applyAccount")}
              </button>
            </div>
          ))}
        </div>
      </section>

      {selectedAccount ? (
        <section className="grid gap-3 rounded-md border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div>
            <h3 className="m-0 text-base font-semibold">{selectedAccount.label}</h3>
            {accountIdentityText(selectedAccount) ? <div className="muted">{accountIdentityText(selectedAccount)}</div> : null}
            <div className="muted">{OFFICIAL_PROVIDER_LABELS[selectedAccount.providerId]} / {selectedAccount.kind === "oauth" ? "OAuth" : "API Key"} / {selectedAccount.id}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onApply(selectedAccount)} disabled={busy}>{t("applyAccount")}</button>
            <button type="button" onClick={() => onRename(selectedAccount)} disabled={busy}>{t("renameAccount")}</button>
            <button type="button" onClick={() => onDuplicate(selectedAccount)} disabled={busy}>{t("duplicate")}</button>
            <button type="button" className="danger" onClick={() => onDelete(selectedAccount)} disabled={busy}>{t("delete")}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type CodexAccountSummary = {
  oauthCount: number;
  appliedCount: number;
  distinctIdentityCount: number;
  appliedDistinctIdentityCount: number;
  activeLabel: string;
  ready: boolean;
};

function CodexAccountReadiness({ summary, t }: { summary: CodexAccountSummary; t: ReturnType<typeof createTranslator> }) {
  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{t("codexAccountReadiness")}</strong>
        <span className="model-meta">{summary.ready ? t("ready") : t("notReady")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="model-meta">{t("codexOAuthAccounts")}: {summary.oauthCount}</span>
        <span className="model-meta">{t("codexAppliedAccounts")}: {summary.appliedCount}</span>
        <span className="model-meta">{t("codexDistinctIdentities")}: {summary.distinctIdentityCount}</span>
        <span className="model-meta">{t("codexAppliedDistinctIdentities")}: {summary.appliedDistinctIdentityCount}</span>
        <span className="model-meta">{t("codexActiveAccount")}: {summary.activeLabel || t("none")}</span>
      </div>
      {!summary.ready ? <div className="muted">{t("codexReadinessHelp")}</div> : null}
    </div>
  );
}

function OfficialProviderForm({
  provider,
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
  onChange: (provider: Provider) => void;
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
  return (
    <div className="grid gap-4">
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Field label={t("provider")}>
          <select
            value={provider.providerId}
            onChange={(event) => {
              const providerId = event.target.value as OfficialProviderId;
              onChange({
                ...provider,
                providerId,
                name: OFFICIAL_PROVIDER_LABELS[providerId],
                authAccountId: undefined,
                models: [],
                defaultModelId: "",
              });
            }}
          >
            {OFFICIAL_PROVIDER_IDS.map((providerId) => (
              <option key={providerId} value={providerId}>
                {OFFICIAL_PROVIDER_LABELS[providerId]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("authMode")}>
          <select value={provider.authMode} onChange={(event) => onChange({ ...provider, authMode: event.target.value as AuthMode })}>
            <option value="existing">{t("authExisting")}</option>
            <option value="account">{t("authAccount")}</option>
            <option value="apiKey">{t("authApiKey")}</option>
          </select>
        </Field>
      </div>
      {provider.authMode === "account" ? (
        <Field label={t("account")} error={fieldError(errors.authAccountId, t)} required>
          <div className="editor-grid grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select value={provider.authAccountId ?? ""} onChange={(event) => onChange({ ...provider, authAccountId: event.target.value })}>
              <option value="">{t("selectAccount")}</option>
              {providerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} / {account.kind === "oauth" ? "OAuth" : "API Key"}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onManageAccounts(provider.providerId)}>
              {t("manageAccounts")}
            </button>
          </div>
        </Field>
      ) : null}
      {provider.authMode === "apiKey" ? (
        <div className="grid gap-2">
          <SecretField value={provider.apiKey} onChange={(apiKey) => onChange({ ...provider, apiKey })} showKey={showKey} setShowKey={setShowKey} error={fieldError(errors.apiKey, t)} required t={t} />
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
  return (
    <div className="grid gap-1">
      {events.map((event, index) => (
        <div key={`${event.type}-${index}`} className="oauth-event muted">
          {formatOAuthEvent(event, t)}
        </div>
      ))}
    </div>
  );
}

function formatOAuthEvent(event: OAuthLoginEvent, t: ReturnType<typeof createTranslator>) {
  if (event.type === "auth") return `${t("oauthOpenUrl")}: ${event.url}`;
  if (event.type === "deviceCode") return `${t("oauthDeviceCode")}: ${event.userCode} / ${event.verificationUri}`;
  if (event.type === "manualCode") return `${t("oauthManualCode")}: ${event.message ?? t("oauthManualCodePrompt")}`;
  if (event.type === "prompt") return `${t("oauthPrompt")}: ${event.message}`;
  if (event.type === "progress") return event.message;
  if (event.type === "success") return event.message ?? t("oauthLoginSuccess");
  if (event.type === "select") return `${event.message}: ${event.selected ?? ""}`;
  return event.message ?? event.type;
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
  onChange: (provider: Provider) => void;
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
          <input value={provider.baseUrl} onChange={(event) => onChange({ ...provider, baseUrl: event.target.value })} />
        </Field>
        <ApiSelect value={provider.api} onChange={(api) => onChange({ ...provider, api })} label={t("apiType")} error={fieldError(errors.api, t)} required />
      </div>
      <SecretField value={provider.apiKey} onChange={(apiKey) => onChange({ ...provider, apiKey })} showKey={showKey} setShowKey={setShowKey} error={fieldError(errors.apiKey, t)} required t={t} />
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
        <input value={search} placeholder={t("searchModels")} onChange={(event) => onSearch(event.target.value)} />
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
          <input value={search} placeholder={t("searchModels")} onChange={(event) => onSearch(event.target.value)} />
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
  draft,
  providerKind,
  onChange,
  t,
}: {
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
      <h3 className="m-0 text-base font-semibold">{t("modelConfig")}</h3>
      <div className="editor-grid grid grid-cols-2 gap-4">
        <Field label={t("modelId")} required>
          <input value={draft.id} onChange={(event) => updateModel({ ...draft, id: event.target.value })} />
        </Field>
        <Field label={t("modelName")}>
          <input value={draft.name ?? ""} onChange={(event) => updateModel({ ...draft, name: event.target.value })} />
        </Field>
        <ApiSelect value={draft.api ?? ""} onChange={(api) => updateModel({ ...draft, api })} label={t("apiType")} />
        <Field label={t("source")}>
          <select value={draft.source ?? "custom"} onChange={(event) => updateModel({ ...draft, source: event.target.value as ModelConfig["source"] })}>
            <option value="custom">{t("customModel")}</option>
            <option value="builtin">{t("builtinModel")}</option>
          </select>
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
          <input value={header.key} placeholder="header" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
          <input value={header.value} placeholder="value" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
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
            <select
              value={value?.[level] === undefined ? "default" : value[level] === null ? "unsupported" : "custom"}
              onChange={(event) => {
                const next = { ...(value ?? {}) };
                if (event.target.value === "default") delete next[level];
                if (event.target.value === "unsupported") next[level] = null;
                if (event.target.value === "custom") next[level] = "";
                onChange(next);
              }}
            >
              <option value="default">{t("defaultValue")}</option>
              <option value="unsupported">{t("unsupported")}</option>
              <option value="custom">{t("customValue")}</option>
            </select>
            <input
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
            <select value={value.maxTokensField ?? ""} onChange={(event) => onChange({ ...value, maxTokensField: event.target.value as CompatConfig["maxTokensField"] })}>
              <option value="">{t("defaultValue")}</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
              <option value="max_tokens">max_tokens</option>
            </select>
          </LabeledField>
          <LabeledField label={t("compatThinkingFormat")} field="thinkingFormat" help={t("compatThinkingFormatHelp")}>
            <input value={value.thinkingFormat ?? ""} onChange={(event) => onChange({ ...value, thinkingFormat: event.target.value as CompatConfig["thinkingFormat"] })} />
          </LabeledField>
          <LabeledField label={t("compatCacheControlFormat")} field="cacheControlFormat" help={t("compatCacheControlFormatHelp")}>
            <select value={value.cacheControlFormat ?? ""} onChange={(event) => onChange({ ...value, cacheControlFormat: event.target.value as CompatConfig["cacheControlFormat"] })}>
              <option value="">{t("defaultValue")}</option>
              <option value="anthropic">anthropic</option>
            </select>
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
      <select value={value === undefined ? "" : value ? "true" : "false"} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}>
        <option value="">default</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
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
            <select value={openRouterRouting.dataCollection ?? ""} onChange={(event) => onChange({ ...value, openRouterRouting: { ...openRouterRouting, dataCollection: event.target.value as "allow" | "deny" | "" } })}>
              <option value="">{t("defaultValue")}</option>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
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

function compareAccountsForDisplay(left: AuthAccount, right: AuthAccount) {
  if (left.activeInPi !== right.activeInPi) return left.activeInPi ? -1 : 1;
  const provider = (OFFICIAL_PROVIDER_LABELS[left.providerId] ?? left.providerId).localeCompare(
    OFFICIAL_PROVIDER_LABELS[right.providerId] ?? right.providerId,
  );
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

function codexAccountSummary(accounts: AuthAccount[]) {
  const oauthAccounts = accounts.filter((account) => account.providerId === "openai-codex" && account.kind === "oauth");
  const appliedAccounts = oauthAccounts.filter((account) => account.lastAppliedAt);
  const identityKeys = new Set(oauthAccounts.map(accountIdentityKey).filter(Boolean));
  const appliedIdentityKeys = new Set(appliedAccounts.map(accountIdentityKey).filter(Boolean));
  const active = oauthAccounts.find((account) => account.activeInPi);
  return {
    oauthCount: oauthAccounts.length,
    appliedCount: appliedAccounts.length,
    distinctIdentityCount: identityKeys.size,
    appliedDistinctIdentityCount: appliedIdentityKeys.size,
    activeLabel: active?.label ?? "",
    ready: oauthAccounts.length >= 2 && appliedAccounts.length >= 2 && identityKeys.size >= 2 && appliedIdentityKeys.size >= 2 && Boolean(active),
  };
}

function accountIdentityKey(account: AuthAccount) {
  const identities = account.identity ?? [];
  const priority = [
    "oauth.chatgptAccountId",
    "oauth.accountId",
    "account.id",
    "accountId",
    "oauth.chatgptUserId",
    "oauth.userId",
    "user.id",
    "oauth.sub",
    "sub",
    "subject",
    "oauth.email",
    "user.email",
    "email",
  ];
  for (const field of priority) {
    const match = identities.find((identity) => identity.field.toLowerCase() === field.toLowerCase());
    if (match) return `${field.toLowerCase()}=${match.value}`;
  }
  return "";
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
