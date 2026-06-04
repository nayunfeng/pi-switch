import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Plus,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  applyProfileToPi,
  fetchCustomProviderModels,
  loadAppConfig,
  saveAppConfig,
  testProfile as runTestProfile,
} from "./commands";
import {
  API_PRESETS,
  AppConfig,
  AppError,
  createCustomProfile,
  createOfficialProfile,
  ModelEntry,
  normalizeConfig,
  OFFICIAL_MODEL_PRESETS,
  OFFICIAL_PROVIDER_IDS,
  OFFICIAL_PROVIDER_LABELS,
  OfficialProviderId,
  Profile,
  ResolvedPaths,
  sanitizeProviderId,
  ThemeMode,
  validationErrors,
} from "./domain";
import { createTranslator, systemLanguage } from "./i18n";

type TestState = {
  status: "idle" | "running" | "success" | "failed" | "timeout";
  output: string;
};

function App() {
  const [config, setConfig] = useState<AppConfig>(() => normalizeConfig({ schemaVersion: 1, theme: "system", profiles: [] }));
  const [paths, setPaths] = useState<ResolvedPaths>();
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [error, setError] = useState("");
  const [testState, setTestState] = useState<TestState>({ status: "idle", output: "" });
  const [candidateModels, setCandidateModels] = useState<string[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [fetching, setFetching] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const language = config.language ?? systemLanguage();
  const t = useMemo(() => createTranslator(language), [language]);
  const activeProfile = config.profiles.find((profile) => profile.id === config.activeProfileId);
  const errors = validationErrors(activeProfile);

  useEffect(() => {
    loadAppConfig()
      .then((result) => {
        setConfig(normalizeConfig(result.config));
        setPaths(result.resolvedPaths);
      })
      .catch((err) => setError(formatError(err, t)))
      .finally(() => setLoading(false));
  }, []);

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
    setError("");
  }

  function updateActiveProfile(profile: Profile) {
    updateConfig({
      ...config,
      profiles: config.profiles.map((item) => (item.id === profile.id ? profile : item)),
    });
  }

  function addProfile(kind: "official" | "custom") {
    const profile = kind === "official" ? createOfficialProfile() : createCustomProfile();
    updateConfig({
      ...config,
      activeProfileId: profile.id,
      profiles: [...config.profiles, profile],
    });
    setShowKey(false);
  }

  function duplicateProfile() {
    if (!activeProfile) return;
    const clone: Profile = {
      ...structuredClone(activeProfile),
      id: crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(6, "0"),
      name: `${activeProfile.name} Copy`,
    };
    clone.id = `profile_${clone.id.slice(0, 6)}`;
    updateConfig({ ...config, activeProfileId: clone.id, profiles: [...config.profiles, clone] });
  }

  function deleteProfile() {
    if (!activeProfile) return;
    const profiles = config.profiles.filter((profile) => profile.id !== activeProfile.id);
    updateConfig({ ...config, activeProfileId: profiles[0]?.id, profiles });
    deleteDialogRef.current?.close();
  }

  async function saveCurrentConfig(nextConfig = config) {
    const profile = nextConfig.profiles.find((item) => item.id === nextConfig.activeProfileId);
    if (Object.keys(validationErrors(profile)).length > 0) {
      setError(t("validationFailed"));
      return false;
    }
    try {
      await saveAppConfig(nextConfig);
      setError("");
      return true;
    } catch (err) {
      setError(formatError(err, t));
      return false;
    }
  }

  async function applyCurrentProfile() {
    if (!activeProfile) return;
    if (Object.keys(errors).length > 0) {
      setError(t("validationFailed"));
      return;
    }
    try {
      await applyProfileToPi(config, activeProfile.id);
      setError("");
    } catch (err) {
      setError(formatError(err, t));
    }
  }

  async function testCurrentProfile() {
    if (!activeProfile) return;
    const saved = await saveCurrentConfig();
    if (!saved) return;
    setTestState({ status: "running", output: 'pi -p "ping"\n' });
    try {
      const result = await runTestProfile(config, activeProfile.id);
      const status = result.status;
      const exitLine = result.exitCode === undefined ? "" : `exitCode: ${result.exitCode}\n`;
      setTestState({
        status,
        output: `${exitLine}stdout:\n${result.stdout || ""}\n\nstderr:\n${result.stderr || ""}`,
      });
      setError("");
    } catch (err) {
      setTestState({ status: "failed", output: formatError(err, t) });
      setError(formatError(err, t));
    }
  }

  async function fetchModels() {
    if (!activeProfile || activeProfile.kind !== "custom") return;
    setFetching(true);
    setSelectedCandidates(new Set());
    setModelSearch("");
    try {
      const models = await fetchCustomProviderModels(activeProfile.baseUrl, activeProfile.apiKey);
      setCandidateModels(models);
      setError("");
    } catch (err) {
      setCandidateModels([]);
      setError(formatError(err, t));
    } finally {
      setFetching(false);
    }
  }

  function addSelectedModels() {
    if (!activeProfile) return;
    const existing = new Set(activeProfile.models.map((model) => model.id));
    const additions = [...selectedCandidates].filter((model) => !existing.has(model)).map((id) => ({ id }));
    updateActiveProfile({ ...activeProfile, models: [...activeProfile.models, ...additions] });
    setSelectedCandidates(new Set());
  }

  function addManualModel() {
    if (!activeProfile || newModelId === "") return;
    const models = [...activeProfile.models, { id: newModelId }];
    updateActiveProfile({
      ...activeProfile,
      models,
      defaultModelId: activeProfile.defaultModelId || newModelId,
    });
    setNewModelId("");
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center">{t("running")}</div>;
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto]" style={{ background: "var(--bg)" }}>
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">{t("profiles")}</h2>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button type="button" className="flex items-center justify-center gap-2" onClick={() => addProfile("official")}>
              <Plus size={15} /> {t("newOfficial")}
            </button>
            <button type="button" className="flex items-center justify-center gap-2" onClick={() => addProfile("custom")}>
              <WandSparkles size={15} /> {t("newCustom")}
            </button>
            <button type="button" className="flex items-center justify-center gap-2" onClick={duplicateProfile} disabled={!activeProfile}>
              <Copy size={15} /> {t("duplicate")}
            </button>
            <button type="button" className="danger flex items-center justify-center gap-2" onClick={() => deleteDialogRef.current?.showModal()} disabled={!activeProfile}>
              <Trash2 size={15} /> {t("delete")}
            </button>
          </div>
          <div className="grid gap-2">
            {config.profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                className={`profile-item ${profile.id === config.activeProfileId ? "active" : ""}`}
                onClick={() => updateConfig({ ...config, activeProfileId: profile.id })}
              >
                <strong>{profile.name}</strong>
                <span className="profile-meta">
                  {profile.kind === "official" ? t("official") : t("custom")} / {profileProviderLabel(profile)}
                </span>
                <span className="profile-meta">{profile.defaultModelId}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 overflow-auto p-5">
          {!activeProfile ? (
            <div className="grid min-h-[420px] place-items-center muted">{t("noProfile")}</div>
          ) : (
            <div className="grid max-w-[960px] gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-semibold">{activeProfile.name}</h2>
                <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  {activeProfile.kind === "official" ? t("official") : t("custom")}
                </span>
              </div>

              <div className="editor-grid grid grid-cols-2 gap-4">
                <Field label={t("name")} error={fieldError(errors.name, t)}>
                  <input value={activeProfile.name} onChange={(event) => updateActiveProfile({ ...activeProfile, name: event.target.value })} />
                </Field>
                <Field label={t("kind")}>
                  <select
                    value={activeProfile.kind}
                    onChange={(event) => {
                      const replacement = event.target.value === "official" ? createOfficialProfile() : createCustomProfile();
                      updateActiveProfile({ ...replacement, id: activeProfile.id, name: activeProfile.name });
                    }}
                  >
                    <option value="official">{t("official")}</option>
                    <option value="custom">{t("custom")}</option>
                  </select>
                </Field>
              </div>

              {activeProfile.kind === "official" ? (
                <OfficialProviderForm profile={activeProfile} onChange={updateActiveProfile} t={t} />
              ) : (
                <CustomProviderForm profile={activeProfile} onChange={updateActiveProfile} errors={errors} t={t} />
              )}

              <Field label={t("apiKey")} error={fieldError(errors.apiKey, t)}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={activeProfile.apiKey}
                    onChange={(event) => updateActiveProfile({ ...activeProfile, apiKey: event.target.value })}
                  />
                  <button type="button" className="icon-button" title={showKey ? t("hide") : t("show")} onClick={() => setShowKey(!showKey)}>
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="m-0 text-base font-semibold">{t("models")}</h3>
                  {activeProfile.kind === "custom" ? (
                    <button type="button" className="flex items-center gap-2" onClick={fetchModels} disabled={fetching}>
                      <Download size={15} /> {t("fetchModels")}
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 rounded-md border p-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  {activeProfile.models.map((model) => (
                    <ModelRow key={model.id} model={model} profile={activeProfile} onChange={updateActiveProfile} t={t} />
                  ))}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input value={newModelId} placeholder={t("modelPlaceholder")} onChange={(event) => setNewModelId(event.target.value)} />
                  <button type="button" onClick={addManualModel}>
                    {t("addModel")}
                  </button>
                </div>
                <div className="field-error">{fieldError(errors.models, t)}</div>
              </section>

              {activeProfile.kind === "custom" && (candidateModels.length > 0 || fetching) ? (
                <section className="grid gap-3 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <input value={modelSearch} placeholder={t("searchModels")} onChange={(event) => setModelSearch(event.target.value)} />
                  <div className="grid max-h-56 gap-2 overflow-auto">
                    {candidateModels
                      .filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase()))
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
                              setSelectedCandidates(next);
                            }}
                          />
                          <span className="model-id">{model}</span>
                        </label>
                      ))}
                  </div>
                  <button type="button" onClick={addSelectedModels} disabled={selectedCandidates.size === 0}>
                    {t("addSelected")}
                  </button>
                </section>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button type="button" className="primary flex items-center gap-2" onClick={() => saveCurrentConfig()}>
                  <Save size={15} /> {t("save")}
                </button>
                <button type="button" className="flex items-center gap-2" onClick={applyCurrentProfile}>
                  <Check size={15} /> {t("apply")}
                </button>
                <button type="button" className="flex items-center gap-2" onClick={testCurrentProfile}>
                  <WandSparkles size={15} /> {t("test")}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="grid gap-3 border-t px-5 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        {error ? <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div> : null}
        <div className="flex items-center justify-between gap-3">
          <strong>{t("output")}</strong>
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
      </footer>

      <dialog ref={deleteDialogRef} className="dialog p-4">
        <p>
          {t("deleteConfirmPrefix")} "{activeProfile?.name}"?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => deleteDialogRef.current?.close()}>
            {t("cancel")}
          </button>
          <button type="button" className="danger" onClick={deleteProfile}>
            {t("confirm")}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
      <div className="field-error">{error}</div>
    </label>
  );
}

function OfficialProviderForm({
  profile,
  onChange,
  t,
}: {
  profile: Extract<Profile, { kind: "official" }>;
  onChange: (profile: Profile) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <Field label={t("provider")}>
      <select
        value={profile.providerId}
        onChange={(event) => {
          const providerId = event.target.value as OfficialProviderId;
          const presets = OFFICIAL_MODEL_PRESETS[providerId].map((id) => ({ id }));
          onChange({
            ...profile,
            providerId,
            models: presets,
            defaultModelId: presets[0]?.id ?? "",
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
  );
}

function CustomProviderForm({
  profile,
  onChange,
  errors,
  t,
}: {
  profile: Extract<Profile, { kind: "custom" }>;
  onChange: (profile: Profile) => void;
  errors: Record<string, string>;
  t: ReturnType<typeof createTranslator>;
}) {
  return (
    <div className="editor-grid grid grid-cols-2 gap-4">
      <Field label={t("providerId")} error={fieldError(errors.providerId, t)}>
        <input value={profile.providerId} onChange={(event) => onChange({ ...profile, providerId: sanitizeProviderId(event.target.value) })} />
      </Field>
      <Field label={t("providerName")}>
        <input value={profile.providerName ?? ""} onChange={(event) => onChange({ ...profile, providerName: event.target.value })} />
      </Field>
      <Field label={t("baseUrl")} error={fieldError(errors.baseUrl, t)}>
        <input value={profile.baseUrl} onChange={(event) => onChange({ ...profile, baseUrl: event.target.value })} />
      </Field>
      <Field label={t("apiType")} error={fieldError(errors.api, t)}>
        <input list="api-presets" value={profile.api} onChange={(event) => onChange({ ...profile, api: event.target.value })} />
        <datalist id="api-presets">
          {API_PRESETS.map((preset) => (
            <option key={preset} value={preset} />
          ))}
        </datalist>
      </Field>
    </div>
  );
}

function ModelRow({
  model,
  profile,
  onChange,
  t,
}: {
  model: ModelEntry;
  profile: Profile;
  onChange: (profile: Profile) => void;
  t: ReturnType<typeof createTranslator>;
}) {
  function removeModel() {
    const models = profile.models.filter((item) => item.id !== model.id);
    onChange({
      ...profile,
      models,
      defaultModelId: profile.defaultModelId === model.id ? models[0]?.id ?? "" : profile.defaultModelId,
    });
  }

  return (
    <div className="model-row">
      <span className="model-id">{model.id}</span>
      <button type="button" onClick={() => onChange({ ...profile, defaultModelId: model.id })}>
        {profile.defaultModelId === model.id ? t("defaultModel") : t("setDefault")}
      </button>
      <button type="button" onClick={removeModel}>
        {t("remove")}
      </button>
    </div>
  );
}

function profileProviderLabel(profile: Profile) {
  if (profile.kind === "official") return OFFICIAL_PROVIDER_LABELS[profile.providerId];
  return sanitizeProviderId(profile.providerId);
}

function fieldError(code: string | undefined, t: ReturnType<typeof createTranslator>) {
  if (!code) return "";
  if (code === "REQUIRED") return t("required");
  if (code === "MODEL_REQUIRED") return t("modelRequired");
  if (code === "DEFAULT_MODEL_MISSING") return t("defaultModelMissing");
  if (code === "RESERVED") return t("reservedProvider");
  return code;
}

function formatError(err: unknown, t: ReturnType<typeof createTranslator>) {
  const error = err as AppError;
  const parts = [error.message ?? String(err)];
  if (error.details) parts.push(error.details);
  if (error.failedFile) parts.push(`${t("failedFile")}: ${error.failedFile}`);
  if (error.writtenFiles?.length) parts.push(`${t("writtenFiles")}: ${error.writtenFiles.join(", ")}`);
  if (error.failedFile) parts.push(t("applyFailureHint"));
  return parts.filter(Boolean).join("\n");
}

export default App;
