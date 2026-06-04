const officialProviders = ["openai", "anthropic", "google", "openrouter", "groq", "mistral", "xai"];
const officialPresets = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4", "claude-3-5-haiku"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  mistral: ["mistral-large-latest", "codestral-latest"],
  xai: ["grok-4", "grok-code-fast"]
};

const fetchedModelFixture = [
  "deepseek-chat",
  "deepseek-coder",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4",
  "claude-3-5-haiku",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4",
  "grok-code-fast"
];

let state = {
  language: "zh-CN",
  theme: "system",
  activeProfileId: "profile_1",
  showKey: false,
  fetchedSelection: new Set(),
  profiles: [
    {
      id: "profile_1",
      name: "OpenAI Daily",
      kind: "official",
      providerId: "openai",
      apiKey: "sk-openai-prototype-key",
      models: ["gpt-4o", "gpt-4o-mini"],
      defaultModelId: "gpt-4o"
    },
    {
      id: "profile_2",
      name: "Relay Strong",
      kind: "custom",
      providerId: "我的中转站",
      providerName: "My Relay",
      baseUrl: "https://relay.example.com/v1",
      apiType: "openai-completions",
      apiKey: "sk-relay-prototype-key",
      models: ["deepseek-chat", "claude-sonnet-4"],
      defaultModelId: "deepseek-chat"
    }
  ]
};

const $ = (id) => document.getElementById(id);

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

function setActiveProfile(id) {
  state.activeProfileId = id;
  state.showKey = false;
  render();
}

function newProfile() {
  const id = `profile_${Math.random().toString(16).slice(2, 8)}`;
  state.profiles.push({
    id,
    name: "New Profile",
    kind: "official",
    providerId: "openai",
    apiKey: "",
    models: ["gpt-4o"],
    defaultModelId: "gpt-4o"
  });
  setActiveProfile(id);
}

function duplicateProfile() {
  const current = activeProfile();
  if (!current) return;
  const clone = structuredClone(current);
  clone.id = `profile_${Math.random().toString(16).slice(2, 8)}`;
  clone.name = `${current.name} Copy`;
  state.profiles.push(clone);
  setActiveProfile(clone.id);
}

function deleteActiveProfile() {
  const current = activeProfile();
  if (!current) return;
  state.profiles = state.profiles.filter((profile) => profile.id !== current.id);
  state.activeProfileId = state.profiles[0]?.id;
  $("deleteDialog").close();
  render();
}

function updateProfile(patch) {
  const current = activeProfile();
  if (!current) return;
  Object.assign(current, patch);
  render();
}

function sanitizeProviderId(value) {
  return value.replace(/\s+/g, "");
}

function validateProfile(profile) {
  const errors = {};
  if (!profile) return { form: "No profile selected." };
  if (!profile.name) errors.name = "Profile name is required.";
  if (!profile.apiKey.trim()) errors.apiKey = "API Key is required.";
  if (!profile.models.length) errors.models = "At least one model is required.";
  if (!profile.models.includes(profile.defaultModelId)) errors.models = "Default model must exist in the model list.";
  if (profile.kind === "custom") {
    if (!profile.providerId) errors.providerId = "Provider ID is required.";
    if (officialProviders.includes(profile.providerId)) errors.providerId = "This provider ID is reserved.";
    if (!profile.baseUrl?.trim()) errors.baseUrl = "Base URL is required.";
  }
  return errors;
}

function renderProfileList() {
  const list = $("profileList");
  list.innerHTML = "";
  for (const profile of state.profiles) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `profile-item ${profile.id === state.activeProfileId ? "active" : ""}`;
    item.innerHTML = `
      <span class="profile-title">${escapeHtml(profile.name)}</span>
      <span class="profile-meta">${profile.kind === "official" ? "Official" : "Custom"} / ${escapeHtml(profile.providerId)}</span>
      <span class="profile-meta">${escapeHtml(profile.defaultModelId)}</span>
    `;
    item.addEventListener("click", () => setActiveProfile(profile.id));
    list.appendChild(item);
  }
}

function renderForm() {
  const profile = activeProfile();
  $("emptyState").hidden = Boolean(profile);
  $("profileForm").hidden = !profile;
  $("duplicateProfileBtn").disabled = !profile;
  $("deleteProfileBtn").disabled = !profile;
  if (!profile) return;

  $("profileKindBadge").textContent = profile.kind === "official" ? "Official provider" : "Custom provider";
  $("profileName").value = profile.name;
  document.querySelectorAll("input[name='profileKind']").forEach((input) => {
    input.checked = input.value === profile.kind;
  });

  $("officialFields").hidden = profile.kind !== "official";
  $("customFields").hidden = profile.kind !== "custom";
  $("fetchModelsBtn").hidden = profile.kind !== "custom";

  $("officialProvider").value = profile.kind === "official" ? profile.providerId : "openai";
  $("customProviderId").value = profile.kind === "custom" ? profile.providerId : "";
  $("customProviderName").value = profile.kind === "custom" ? profile.providerName || "" : "";
  $("customBaseUrl").value = profile.kind === "custom" ? profile.baseUrl || "" : "";
  $("customApiType").value = profile.kind === "custom" ? profile.apiType || "openai-completions" : "openai-completions";
  $("apiKey").type = state.showKey ? "text" : "password";
  $("apiKey").value = profile.apiKey;
  $("toggleKeyBtn").textContent = state.showKey ? "Hide" : "Show";

  const errors = validateProfile(profile);
  $("nameError").textContent = errors.name || "";
  $("providerIdError").textContent = errors.providerId || "";
  $("baseUrlError").textContent = errors.baseUrl || "";
  $("apiKeyError").textContent = errors.apiKey || "";
  $("modelsError").textContent = errors.models || "";

  renderModels(profile);
}

function renderModels(profile) {
  const modelList = $("modelList");
  modelList.innerHTML = "";
  for (const modelId of profile.models) {
    const row = document.createElement("div");
    row.className = "model-row";
    row.innerHTML = `
      <span class="model-id">${escapeHtml(modelId)}</span>
      <button type="button" data-default="${escapeAttr(modelId)}">${modelId === profile.defaultModelId ? "default" : "set default"}</button>
      <button type="button" data-remove="${escapeAttr(modelId)}">remove</button>
    `;
    modelList.appendChild(row);
  }
}

function renderOfficialProviderOptions() {
  const select = $("officialProvider");
  select.innerHTML = officialProviders.map((provider) => `<option value="${provider}">${provider}</option>`).join("");
}

function renderFetchedModels() {
  const search = $("modelSearch").value.toLowerCase();
  const container = $("fetchedModels");
  container.innerHTML = "";
  for (const modelId of fetchedModelFixture.filter((id) => id.toLowerCase().includes(search))) {
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" value="${escapeAttr(modelId)}" ${state.fetchedSelection.has(modelId) ? "checked" : ""} />
      <span class="model-id">${escapeHtml(modelId)}</span>
    `;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        state.fetchedSelection.add(modelId);
      } else {
        state.fetchedSelection.delete(modelId);
      }
    });
    container.appendChild(label);
  }
}

function saveProfileFromForm() {
  const profile = activeProfile();
  if (!profile) return false;
  profile.name = $("profileName").value;
  profile.apiKey = $("apiKey").value.trim();
  if (profile.kind === "official") {
    profile.providerId = $("officialProvider").value;
  } else {
    profile.providerId = sanitizeProviderId($("customProviderId").value);
    profile.providerName = $("customProviderName").value;
    profile.baseUrl = $("customBaseUrl").value.trim();
    profile.apiType = $("customApiType").value;
  }
  render();
  return Object.keys(validateProfile(profile)).length === 0;
}

function applyProfile() {
  const ok = saveProfileFromForm();
  const profile = activeProfile();
  if (!ok || !profile) {
    setOutput("failed", "Validation failed. Fix the highlighted fields.");
    return false;
  }
  setOutput("idle", "");
  return true;
}

function testProfile() {
  if (!applyProfile()) return;
  setOutput("running", 'pi -p "ping"\n\nRunning in user home directory...');
  window.setTimeout(() => {
    setOutput("success", "pong");
  }, 700);
}

function setOutput(status, text) {
  $("testStatus").textContent = status;
  $("testOutput").textContent = text || "No test run yet.";
}

function addModel(modelId) {
  const profile = activeProfile();
  if (!profile || modelId === "") return;
  profile.models.push(modelId);
  if (!profile.defaultModelId) profile.defaultModelId = modelId;
  render();
}

function bindEvents() {
  $("newProfileBtn").addEventListener("click", newProfile);
  $("duplicateProfileBtn").addEventListener("click", duplicateProfile);
  $("deleteProfileBtn").addEventListener("click", () => {
    const profile = activeProfile();
    if (!profile) return;
    $("deleteMessage").textContent = `确定删除 Profile "${profile.name}"？`;
    $("deleteDialog").showModal();
  });
  $("confirmDeleteBtn").addEventListener("click", deleteActiveProfile);
  $("toggleKeyBtn").addEventListener("click", () => {
    state.showKey = !state.showKey;
    render();
  });
  $("saveProfileBtn").addEventListener("click", () => {
    saveProfileFromForm();
  });
  $("applyProfileBtn").addEventListener("click", applyProfile);
  $("testProfileBtn").addEventListener("click", testProfile);
  $("addModelBtn").addEventListener("click", () => {
    addModel($("newModelId").value);
    $("newModelId").value = "";
  });
  $("fetchModelsBtn").addEventListener("click", () => {
    state.fetchedSelection = new Set();
    $("modelSearch").value = "";
    renderFetchedModels();
    $("fetchDialog").showModal();
  });
  $("modelSearch").addEventListener("input", renderFetchedModels);
  $("addFetchedBtn").addEventListener("click", () => {
    for (const modelId of state.fetchedSelection) addModel(modelId);
    $("fetchDialog").close();
  });
  $("themeSelect").addEventListener("change", (event) => {
    state.theme = event.target.value;
    applyTheme();
  });
  $("languageSelect").addEventListener("change", (event) => {
    state.language = event.target.value;
  });
  $("profileName").addEventListener("input", (event) => updateProfile({ name: event.target.value }));
  $("apiKey").addEventListener("input", (event) => updateProfile({ apiKey: event.target.value }));
  $("officialProvider").addEventListener("change", (event) => {
    const providerId = event.target.value;
    const presets = officialPresets[providerId] || [];
    updateProfile({
      providerId,
      models: presets.slice(0, 2),
      defaultModelId: presets[0] || ""
    });
  });
  $("customProviderId").addEventListener("input", (event) => updateProfile({ providerId: sanitizeProviderId(event.target.value) }));
  $("customProviderName").addEventListener("input", (event) => updateProfile({ providerName: event.target.value }));
  $("customBaseUrl").addEventListener("input", (event) => updateProfile({ baseUrl: event.target.value.trim() }));
  $("customApiType").addEventListener("input", (event) => updateProfile({ apiType: event.target.value }));
  document.querySelectorAll("input[name='profileKind']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const current = activeProfile();
      if (!current || !event.target.checked) return;
      if (event.target.value === "official") {
        Object.assign(current, {
          kind: "official",
          providerId: "openai",
          models: ["gpt-4o", "gpt-4o-mini"],
          defaultModelId: "gpt-4o"
        });
      } else {
        Object.assign(current, {
          kind: "custom",
          providerId: "my-relay",
          providerName: "My Relay",
          baseUrl: "https://relay.example.com/v1",
          apiType: "openai-completions",
          models: ["deepseek-chat"],
          defaultModelId: "deepseek-chat"
        });
      }
      render();
    });
  });
  $("modelList").addEventListener("click", (event) => {
    const profile = activeProfile();
    if (!profile || event.target.tagName !== "BUTTON") return;
    const defaultId = event.target.dataset.default;
    const removeId = event.target.dataset.remove;
    if (defaultId) profile.defaultModelId = defaultId;
    if (removeId) {
      profile.models = profile.models.filter((id) => id !== removeId);
      if (profile.defaultModelId === removeId) profile.defaultModelId = profile.models[0] || "";
    }
    render();
  });
}

function applyTheme() {
  const dark = state.theme === "dark" || (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
}

function render() {
  renderProfileList();
  renderForm();
  $("languageSelect").value = state.language;
  $("themeSelect").value = state.theme;
  applyTheme();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

renderOfficialProviderOptions();
bindEvents();
render();
