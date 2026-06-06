use base64::{engine::general_purpose::URL_SAFE, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt},
    process::Command,
    time::{timeout, Duration},
};

const SCHEMA_VERSION: u32 = 3;
const ACCOUNTS_VERSION: u32 = 1;
static ACCOUNT_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static OAUTH_LOGIN_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const OFFICIAL_PROVIDER_IDS: &[&str] = &[
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

#[cfg(target_os = "linux")]
fn configure_linux_webview_environment() {
    if !is_wsl_environment() {
        return;
    }

    set_env_if_unset("LIBGL_ALWAYS_SOFTWARE", "1");
    set_env_if_unset("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}

#[cfg(target_os = "linux")]
fn is_wsl_environment() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() || std::env::var_os("WSL_INTEROP").is_some() {
        return true;
    }

    fs::read_to_string("/proc/version")
        .map(|version| {
            let version = version.to_ascii_lowercase();
            version.contains("microsoft") || version.contains("wsl")
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn set_env_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub language: Option<Language>,
    pub theme: ThemeMode,
    pub active_provider_id: Option<String>,
    pub providers: Vec<Provider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Language {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Provider {
    Official(OfficialProvider),
    Custom(CustomProvider),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialProvider {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: AuthMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_account_id: Option<String>,
    #[serde(default)]
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advanced: Option<ProviderAdvancedConfig>,
    pub models: Vec<ModelConfig>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<HeaderEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_header: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compat: Option<CompatConfig>,
    pub models: Vec<ModelConfig>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode {
    Existing,
    ApiKey,
    Account,
}

fn default_auth_mode() -> AuthMode {
    AuthMode::Existing
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsStore {
    #[serde(default = "default_accounts_version")]
    pub version: u32,
    #[serde(default)]
    pub accounts: Vec<AuthAccount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    pub version: u32,
    pub accounts: Vec<AuthAccountView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthAccount {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub kind: AuthAccountKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub credential: Value,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_applied_at: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub active_in_pi: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthAccountView {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub kind: AuthAccountKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub identity: Vec<AuthAccountIdentity>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_applied_at: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub active_in_pi: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthAccountIdentity {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthAccountKind {
    #[serde(rename = "oauth", alias = "oAuth")]
    OAuth,
    #[serde(rename = "apiKey")]
    ApiKey,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn default_accounts_version() -> u32 {
    ACCOUNTS_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAdvancedConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<HeaderEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_header: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compat: Option<CompatConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ModelSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_built_in: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<CostConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<HeaderEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compat: Option<CompatConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level_map: Option<HashMap<String, Option<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelSource {
    Builtin,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompatConfig {
    pub supports_store: Option<bool>,
    pub supports_developer_role: Option<bool>,
    pub supports_reasoning_effort: Option<bool>,
    pub supports_usage_in_streaming: Option<bool>,
    pub max_tokens_field: Option<String>,
    pub requires_tool_result_name: Option<bool>,
    pub requires_assistant_after_tool_result: Option<bool>,
    pub requires_thinking_as_text: Option<bool>,
    pub requires_reasoning_content_on_assistant_messages: Option<bool>,
    pub thinking_format: Option<String>,
    pub zai_tool_stream: Option<bool>,
    pub supports_strict_mode: Option<bool>,
    pub cache_control_format: Option<String>,
    pub send_session_affinity_headers: Option<bool>,
    pub supports_long_cache_retention: Option<bool>,
    pub send_session_id_header: Option<bool>,
    pub supports_eager_tool_input_streaming: Option<bool>,
    pub supports_cache_control_on_tools: Option<bool>,
    pub supports_temperature: Option<bool>,
    pub force_adaptive_thinking: Option<bool>,
    pub allow_empty_signature: Option<bool>,
    pub open_router_routing: Option<OpenRouterRouting>,
    pub vercel_gateway_routing: Option<VercelGatewayRouting>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterRouting {
    pub allow_fallbacks: Option<bool>,
    pub require_parameters: Option<bool>,
    pub data_collection: Option<String>,
    pub zdr: Option<bool>,
    pub enforce_distillable_text: Option<bool>,
    pub order: Option<Vec<String>>,
    pub only: Option<Vec<String>>,
    pub ignore: Option<Vec<String>>,
    pub quantizations: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_partition: Option<String>,
    pub max_price_prompt: Option<f64>,
    pub max_price_completion: Option<f64>,
    pub max_price_image: Option<f64>,
    pub max_price_audio: Option<f64>,
    pub max_price_request: Option<f64>,
    pub min_throughput_p50: Option<f64>,
    pub min_throughput_p75: Option<f64>,
    pub min_throughput_p90: Option<f64>,
    pub min_throughput_p99: Option<f64>,
    pub max_latency_p50: Option<f64>,
    pub max_latency_p75: Option<f64>,
    pub max_latency_p90: Option<f64>,
    pub max_latency_p99: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VercelGatewayRouting {
    pub only: Option<Vec<String>>,
    pub order: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPaths {
    pub app_config_file: String,
    pub pi_models_file: String,
    pub pi_auth_file: String,
    pub pi_settings_file: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAppConfigResult {
    pub config: AppConfig,
    pub resolved_paths: ResolvedPaths,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAppConfigInput {
    pub config: AppConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProviderInput {
    pub config: AppConfig,
    pub provider_entry_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderInput {
    pub config: AppConfig,
    pub provider_entry_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderResult {
    pub status: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchCustomProviderModelsInput {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchCustomProviderModelsResult {
    pub models: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPiModelsInput {
    pub provider_id: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginOfficialProviderOAuthInput {
    pub provider_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginOfficialProviderOAuthResult {
    pub account: AuthAccountView,
    pub provider_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOAuthManualCodeInput {
    pub login_id: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApiKeyAccountInput {
    pub provider_id: String,
    pub label: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAuthAccountInput {
    pub account_id: String,
    pub label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAuthAccountInput {
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateAuthAccountInput {
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAuthAccountInput {
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPiAuthAccountInput {
    pub provider_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_id: Option<String>,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiModelInfo {
    pub provider: String,
    pub id: String,
    pub context: String,
    pub max_out: String,
    pub thinking: bool,
    pub images: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiRegistryModel {
    provider: String,
    id: String,
    context_window: u64,
    max_tokens: u64,
    reasoning: bool,
    input: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPiModelsResult {
    pub models: Vec<PiModelInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
    pub failed_file: Option<String>,
    pub written_files: Option<Vec<String>>,
}

type AppResult<T> = Result<T, AppError>;

impl AppError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            details: None,
            failed_file: None,
            written_files: None,
        }
    }

    fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    fn with_file(mut self, failed_file: &str, written_files: &[String]) -> Self {
        self.failed_file = Some(failed_file.to_string());
        self.written_files = Some(written_files.to_vec());
        self
    }

    fn message_with_details(&self) -> String {
        match &self.details {
            Some(details) if !details.is_empty() => format!("{} ({details})", self.message),
            _ => self.message.clone(),
        }
    }
}

#[derive(Debug, Clone)]
struct Paths {
    app_config_dir: PathBuf,
    app_config_file: PathBuf,
    accounts_file: PathBuf,
    pi_agent_dir: PathBuf,
    pi_models_file: PathBuf,
    pi_auth_file: PathBuf,
    pi_settings_file: PathBuf,
    home: PathBuf,
}

fn default_config() -> AppConfig {
    AppConfig {
        schema_version: SCHEMA_VERSION,
        language: None,
        theme: ThemeMode::System,
        active_provider_id: None,
        providers: Vec::new(),
    }
}

fn resolve_paths() -> AppResult<Paths> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::new("PATH_RESOLVE_FAILED", "无法解析当前用户 home 目录"))?;
    let app_config_dir = home.join("PiSwitch");
    let app_config_file = app_config_dir.join("config.json");
    let accounts_file = app_config_dir.join("accounts.json");
    let pi_agent_dir = home.join(".pi").join("agent");
    Ok(Paths {
        app_config_dir,
        app_config_file,
        accounts_file,
        pi_models_file: pi_agent_dir.join("models.json"),
        pi_auth_file: pi_agent_dir.join("auth.json"),
        pi_settings_file: pi_agent_dir.join("settings.json"),
        pi_agent_dir,
        home,
    })
}

fn paths_for_frontend(paths: &Paths) -> ResolvedPaths {
    ResolvedPaths {
        app_config_file: paths.app_config_file.display().to_string(),
        pi_models_file: paths.pi_models_file.display().to_string(),
        pi_auth_file: paths.pi_auth_file.display().to_string(),
        pi_settings_file: paths.pi_settings_file.display().to_string(),
    }
}

fn default_accounts_store() -> AccountsStore {
    AccountsStore {
        version: ACCOUNTS_VERSION,
        accounts: Vec::new(),
    }
}

#[derive(Default)]
struct OAuthLoginSessions {
    manual_code_files: Mutex<HashMap<String, PathBuf>>,
}

fn create_oauth_login_id() -> String {
    let sequence = OAUTH_LOGIN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("oauth_{}_{}_{}", std::process::id(), now_nanos(), sequence)
}

fn register_oauth_login_session(
    sessions: &OAuthLoginSessions,
    login_id: &str,
    manual_code_file: &Path,
) -> AppResult<()> {
    let mut files = sessions
        .manual_code_files
        .lock()
        .map_err(|_| AppError::new("OAUTH_LOGIN_FAILED", "OAuth 登录会话状态不可用"))?;
    files.insert(login_id.to_string(), manual_code_file.to_path_buf());
    Ok(())
}

fn unregister_oauth_login_session(sessions: &OAuthLoginSessions, login_id: &str) {
    if let Ok(mut files) = sessions.manual_code_files.lock() {
        files.remove(login_id);
    }
}

struct OAuthLoginSessionGuard<'a> {
    sessions: &'a OAuthLoginSessions,
    login_id: String,
    manual_code_file: PathBuf,
}

impl<'a> OAuthLoginSessionGuard<'a> {
    fn register(
        sessions: &'a OAuthLoginSessions,
        login_id: String,
        manual_code_file: PathBuf,
    ) -> AppResult<Self> {
        register_oauth_login_session(sessions, &login_id, &manual_code_file)?;
        Ok(Self {
            sessions,
            login_id,
            manual_code_file,
        })
    }

    fn cleanup(&self) {
        unregister_oauth_login_session(self.sessions, &self.login_id);
        let _ = fs::remove_file(&self.manual_code_file);
    }
}

impl Drop for OAuthLoginSessionGuard<'_> {
    fn drop(&mut self) {
        self.cleanup();
    }
}

fn submit_oauth_manual_code_to_session(
    sessions: &OAuthLoginSessions,
    input: SubmitOAuthManualCodeInput,
) -> AppResult<()> {
    let code = input.code.trim();
    if code.is_empty() {
        return Err(validation_error("OAuth 登录码不能为空"));
    }
    let path = {
        let files = sessions
            .manual_code_files
            .lock()
            .map_err(|_| AppError::new("OAUTH_LOGIN_FAILED", "OAuth 登录会话状态不可用"))?;
        files
            .get(&input.login_id)
            .cloned()
            .ok_or_else(|| validation_error("OAuth 登录会话不存在或已结束"))?
    };
    fs::write(&path, code).map_err(|err| {
        AppError::new("OAUTH_LOGIN_FAILED", "写入 OAuth 登录码失败").with_details(err.to_string())
    })
}

fn identity_field_is_safe(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "email"
            | "mail"
            | "username"
            | "login"
            | "account"
            | "accountid"
            | "organization"
            | "org"
            | "team"
            | "tenant"
            | "subject"
            | "sub"
            | "id"
    )
}

fn field_name_is_secret(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        "token",
        "key",
        "secret",
        "refresh",
        "access",
        "authorization",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn collect_account_identity_fields(
    value: &Value,
    prefix: &str,
    depth: usize,
    fields: &mut Vec<AuthAccountIdentity>,
) {
    if depth > 3 || fields.len() >= 8 {
        return;
    }
    let Some(object) = value.as_object() else {
        return;
    };
    for (key, item) in object {
        if fields.len() >= 8 || field_name_is_secret(key) {
            continue;
        }
        let field = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        if identity_field_is_safe(key) {
            let text = item
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= 160)
                .map(ToString::to_string)
                .or_else(|| {
                    item.as_i64()
                        .map(|value| value.to_string())
                        .filter(|value| value.len() <= 160)
                });
            if let Some(value) = text {
                fields.push(AuthAccountIdentity { field, value });
                continue;
            }
        }
        if item.is_object() {
            collect_account_identity_fields(item, &field, depth + 1, fields);
        }
    }
}

fn push_account_identity_field(
    fields: &mut Vec<AuthAccountIdentity>,
    field: &str,
    value: Option<&Value>,
) {
    if fields.len() >= 8 {
        return;
    }
    let Some(text) = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 160)
    else {
        return;
    };
    if fields
        .iter()
        .any(|item| item.field == field && item.value == text)
    {
        return;
    }
    fields.push(AuthAccountIdentity {
        field: field.to_string(),
        value: text.to_string(),
    });
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let padded = match payload.len() % 4 {
        0 => payload.to_string(),
        remainder => format!("{payload}{}", "=".repeat(4 - remainder)),
    };
    let bytes = URL_SAFE.decode(padded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn collect_jwt_payload_identity_fields(payload: &Value, fields: &mut Vec<AuthAccountIdentity>) {
    let Some(object) = payload.as_object() else {
        return;
    };
    push_account_identity_field(fields, "oauth.email", object.get("email"));
    push_account_identity_field(fields, "oauth.sub", object.get("sub"));
    push_account_identity_field(fields, "oauth.authProvider", object.get("auth_provider"));

    let auth = object
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object);
    if let Some(auth) = auth {
        push_account_identity_field(
            fields,
            "oauth.chatgptAccountId",
            auth.get("chatgpt_account_id"),
        );
        push_account_identity_field(fields, "oauth.accountId", auth.get("account_id"));
        push_account_identity_field(fields, "oauth.chatgptUserId", auth.get("chatgpt_user_id"));
        push_account_identity_field(fields, "oauth.userId", auth.get("user_id"));
    }
}

fn collect_jwt_identity_fields(value: &Value, depth: usize, fields: &mut Vec<AuthAccountIdentity>) {
    if depth > 4 || fields.len() >= 8 {
        return;
    }
    match value {
        Value::Object(object) => {
            for (key, item) in object {
                if fields.len() >= 8 {
                    return;
                }
                if field_name_is_secret(key) {
                    if let Some(token) = item.as_str() {
                        if let Some(payload) = decode_jwt_payload(token) {
                            collect_jwt_payload_identity_fields(&payload, fields);
                        }
                    }
                }
                collect_jwt_identity_fields(item, depth + 1, fields);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_jwt_identity_fields(item, depth + 1, fields);
            }
        }
        _ => {}
    }
}

fn account_identity(credential: &Value) -> Vec<AuthAccountIdentity> {
    let mut fields = Vec::new();
    collect_account_identity_fields(credential, "", 0, &mut fields);
    collect_jwt_identity_fields(credential, 0, &mut fields);
    fields
}

fn oauth_identity_key(credential: &Value) -> Option<String> {
    if !credential_is_oauth(credential) {
        return None;
    }
    let identities = account_identity(credential);
    [
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
    ]
    .iter()
    .find_map(|field| {
        identities
            .iter()
            .find(|identity| identity.field.eq_ignore_ascii_case(field))
            .map(|identity| format!("{}={}", field.to_ascii_lowercase(), identity.value))
    })
}

fn account_to_view(account: &AuthAccount) -> AuthAccountView {
    AuthAccountView {
        id: account.id.clone(),
        provider_id: account.provider_id.clone(),
        label: account.label.clone(),
        kind: account.kind.clone(),
        base_url: account.base_url.clone(),
        identity: account_identity(&account.credential),
        created_at: account.created_at.clone(),
        updated_at: account.updated_at.clone(),
        last_applied_at: account.last_applied_at.clone(),
        active_in_pi: account.active_in_pi,
    }
}

fn accounts_to_view(store: &AccountsStore) -> AccountsView {
    AccountsView {
        version: store.version,
        accounts: store.accounts.iter().map(account_to_view).collect(),
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn now_timestamp_string() -> String {
    now_millis().to_string()
}

fn create_account_id() -> String {
    let sequence = ACCOUNT_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "account_{}_{}_{}",
        std::process::id(),
        now_nanos(),
        sequence
    )
}

fn normalize_account_label(
    label: Option<&str>,
    provider_id: &str,
    kind: AuthAccountKind,
) -> String {
    let trimmed = label.unwrap_or_default().trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    let suffix = match kind {
        AuthAccountKind::OAuth => "OAuth",
        AuthAccountKind::ApiKey => "API Key",
    };
    format!("{provider_id} {suffix}")
}

fn oauth_account_label_from_identity(credential: &Value) -> Option<String> {
    if !credential_is_oauth(credential) {
        return None;
    }
    let identities = account_identity(credential);
    [
        "oauth.email",
        "user.email",
        "email",
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
    ]
    .iter()
    .find_map(|field| {
        identities
            .iter()
            .find(|identity| identity.field.eq_ignore_ascii_case(field))
            .map(|identity| identity.value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn normalize_account_label_for_credential(
    label: Option<&str>,
    provider_id: &str,
    kind: AuthAccountKind,
    credential: &Value,
) -> String {
    let trimmed = label.unwrap_or_default().trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    if kind == AuthAccountKind::OAuth {
        if let Some(identity_label) = oauth_account_label_from_identity(credential) {
            return identity_label;
        }
    }
    normalize_account_label(None, provider_id, kind)
}

fn unique_account_label(store: &AccountsStore, base_label: &str) -> String {
    let base = base_label.trim();
    if base.is_empty() {
        return "Account".to_string();
    }
    if !store.accounts.iter().any(|account| account.label == base) {
        return base.to_string();
    }
    for index in 2.. {
        let candidate = format!("{base} {index}");
        if !store
            .accounts
            .iter()
            .any(|account| account.label == candidate)
        {
            return candidate;
        }
    }
    unreachable!("infinite iterator should always produce a unique label")
}

fn load_accounts_store_from_path(path: &Path) -> AppResult<AccountsStore> {
    if !path.exists() {
        return Ok(default_accounts_store());
    }
    let text = fs::read_to_string(path).map_err(|err| {
        AppError::new("ACCOUNTS_READ_FAILED", "读取账号库失败").with_details(err.to_string())
    })?;
    let mut store: AccountsStore = serde_json::from_str(&text).map_err(|err| {
        AppError::new("ACCOUNTS_PARSE_FAILED", "账号库 JSON 无法解析").with_details(err.to_string())
    })?;
    if store.version != ACCOUNTS_VERSION {
        return Err(AppError::new(
            "UNSUPPORTED_ACCOUNTS_VERSION",
            format!("不支持的 accounts.json version: {}", store.version),
        ));
    }
    store.accounts = normalize_accounts(store.accounts)?;
    Ok(store)
}

fn normalize_accounts(accounts: Vec<AuthAccount>) -> AppResult<Vec<AuthAccount>> {
    let mut ids = HashSet::new();
    let mut normalized = Vec::new();
    for mut account in accounts {
        account.id = account.id.trim().to_string();
        account.provider_id = account.provider_id.trim().to_string();
        account.label = account.label.trim().to_string();
        account.base_url = account.base_url.and_then(|value| {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        });
        if account.id.is_empty() {
            return Err(validation_error("账号 ID 不能为空"));
        }
        if !ids.insert(account.id.clone()) {
            return Err(validation_error(format!("账号 ID 重复: {}", account.id)));
        }
        validate_account_provider_id(&account.provider_id, &account.kind)?;
        if account.label.is_empty() {
            account.label =
                normalize_account_label(None, &account.provider_id, account.kind.clone());
        }
        account.active_in_pi = false;
        validate_account_credential(&account)?;
        normalized.push(account);
    }
    Ok(normalized)
}

fn save_accounts_store_to_path(path: &Path, store: &AccountsStore) -> AppResult<()> {
    let mut normalized = store.clone();
    normalized.accounts = normalize_accounts(normalized.accounts)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::new("ACCOUNTS_WRITE_FAILED", "创建账号库目录失败")
                .with_details(err.to_string())
        })?;
    }
    atomic_write_json(path, &normalized).map_err(|err| {
        AppError::new("ACCOUNTS_WRITE_FAILED", "写入账号库失败")
            .with_details(err.message_with_details())
    })?;
    restrict_file_permissions(path)?;
    Ok(())
}

fn restrict_file_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|err| {
            AppError::new("ACCOUNTS_WRITE_FAILED", "设置账号库文件权限失败")
                .with_details(err.to_string())
        })?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn load_accounts_store() -> AppResult<AccountsStore> {
    let paths = resolve_paths()?;
    let mut store = load_accounts_store_from_path(&paths.accounts_file)?;
    if annotate_active_accounts_from_paths(&mut store, &paths.pi_auth_file, &paths.pi_models_file) {
        save_accounts_store_to_path(&paths.accounts_file, &store)?;
    }
    Ok(store)
}

fn save_accounts_store(store: &AccountsStore) -> AppResult<()> {
    let paths = resolve_paths()?;
    save_accounts_store_to_path(&paths.accounts_file, store)
}

fn annotate_active_accounts(store: &mut AccountsStore, pi_auth_file: &Path) -> bool {
    let auth = read_json_object(pi_auth_file, "PI_AUTH_READ_FAILED", "auth.json").ok();
    for account in &mut store.accounts {
        account.active_in_pi = false;
    }
    let Some(auth) = auth else {
        return false;
    };

    let mut changed = false;
    let provider_ids = store
        .accounts
        .iter()
        .map(|account| account.provider_id.clone())
        .collect::<HashSet<_>>();
    for provider_id in provider_ids {
        let Some(current_credential) = auth.get(&provider_id) else {
            continue;
        };
        let Some(index) =
            matching_current_pi_auth_account_index(store, current_credential, &provider_id, None)
        else {
            continue;
        };
        let account = &mut store.accounts[index];
        account.active_in_pi = true;
        if account.credential != *current_credential {
            account.credential = current_credential.clone();
            account.updated_at = now_timestamp_string();
            changed = true;
        }
    }
    changed
}

fn annotate_active_accounts_from_paths(
    store: &mut AccountsStore,
    pi_auth_file: &Path,
    pi_models_file: &Path,
) -> bool {
    let changed = annotate_active_accounts(store, pi_auth_file);
    for account in &mut store.accounts {
        if account.kind != AuthAccountKind::ApiKey {
            continue;
        }
        if account_api_key_endpoint_matches_pi_models(account, pi_models_file).unwrap_or(false) {
            if !account_provider_writes_auth(account) {
                account.active_in_pi = true;
            }
        } else {
            account.active_in_pi = false;
        }
    }
    changed
}

fn credential_same_auth_kind(left: &Value, right: &Value) -> bool {
    left.get("type").and_then(Value::as_str) == right.get("type").and_then(Value::as_str)
}

fn credential_is_oauth(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("oauth")
}

fn matching_current_pi_auth_account_index(
    store: &AccountsStore,
    current_credential: &Value,
    replacing_provider_id: &str,
    exclude_account_id: Option<&str>,
) -> Option<usize> {
    let exact_index = store.accounts.iter().position(|account| {
        account.provider_id == replacing_provider_id
            && Some(account.id.as_str()) != exclude_account_id
            && account.credential == *current_credential
    });
    let identity_index = oauth_identity_key(current_credential).and_then(|identity_key| {
        store.accounts.iter().position(|account| {
            account.provider_id == replacing_provider_id
                && Some(account.id.as_str()) != exclude_account_id
                && oauth_identity_key(&account.credential).as_deref() == Some(identity_key.as_str())
        })
    });
    let latest_applied_index = store
        .accounts
        .iter()
        .enumerate()
        .filter(|(_, account)| {
            account.provider_id == replacing_provider_id
                && Some(account.id.as_str()) != exclude_account_id
                && credential_is_oauth(current_credential)
                && credential_same_auth_kind(&account.credential, current_credential)
                && account.last_applied_at.is_some()
        })
        .max_by(|(_, left), (_, right)| left.last_applied_at.cmp(&right.last_applied_at))
        .map(|(index, _)| index);

    exact_index.or(identity_index).or(latest_applied_index)
}

fn account_matches_current_pi_auth(
    store: &AccountsStore,
    account_id: &str,
    pi_auth_file: &Path,
) -> AppResult<bool> {
    let Some(account) = store
        .accounts
        .iter()
        .find(|account| account.id == account_id)
    else {
        return Ok(false);
    };
    let auth = read_json_object(pi_auth_file, "PI_AUTH_READ_FAILED", "auth.json")?;
    let Some(current_credential) = auth.get(&account.provider_id) else {
        return Ok(false);
    };
    Ok(matching_current_pi_auth_account_index(
        store,
        current_credential,
        &account.provider_id,
        None,
    )
    .is_some_and(|index| store.accounts[index].id == account_id))
}

fn account_matches_current_pi_state(
    store: &AccountsStore,
    account_id: &str,
    pi_auth_file: &Path,
    pi_models_file: &Path,
) -> AppResult<bool> {
    let Some(account) = store
        .accounts
        .iter()
        .find(|account| account.id == account_id)
    else {
        return Ok(false);
    };
    let auth_matches = if account_provider_writes_auth(account) {
        account_matches_current_pi_auth(store, account_id, pi_auth_file)?
    } else {
        true
    };
    if !auth_matches {
        return Ok(false);
    }
    if account.kind == AuthAccountKind::ApiKey {
        return account_api_key_endpoint_matches_pi_models(account, pi_models_file);
    }
    Ok(true)
}

fn sync_current_pi_auth_to_matching_account(
    store: &mut AccountsStore,
    pi_auth_file: &Path,
    replacing_provider_id: &str,
    exclude_account_id: Option<&str>,
) -> AppResult<bool> {
    let auth = read_json_object(pi_auth_file, "PI_AUTH_READ_FAILED", "auth.json")?;
    let Some(current_credential) = auth.get(replacing_provider_id) else {
        return Ok(false);
    };

    let Some(index) = matching_current_pi_auth_account_index(
        store,
        current_credential,
        replacing_provider_id,
        exclude_account_id,
    ) else {
        return Ok(false);
    };
    let account = &mut store.accounts[index];
    if account.credential != *current_credential {
        account.credential = current_credential.clone();
        account.updated_at = now_timestamp_string();
        return Ok(true);
    }
    Ok(false)
}

fn validate_official_provider_id(provider_id: &str) -> AppResult<()> {
    if provider_id.trim().is_empty() || !OFFICIAL_PROVIDER_IDS.contains(&provider_id) {
        return Err(validation_error("未知官方供应商"));
    }
    Ok(())
}

fn is_official_provider_id(provider_id: &str) -> bool {
    OFFICIAL_PROVIDER_IDS.contains(&provider_id)
}

fn validate_account_provider_id(provider_id: &str, kind: &AuthAccountKind) -> AppResult<()> {
    if provider_id.trim().is_empty() {
        return Err(validation_error("账号供应商不能为空"));
    }
    if matches!(kind, AuthAccountKind::OAuth) {
        validate_official_provider_id(provider_id)?;
    }
    Ok(())
}

fn validate_account_credential(account: &AuthAccount) -> AppResult<()> {
    match account.kind {
        AuthAccountKind::OAuth => {
            let object = account
                .credential
                .as_object()
                .ok_or_else(|| validation_error("OAuth 凭证必须是 object"))?;
            if object.get("type").and_then(Value::as_str) != Some("oauth") {
                return Err(validation_error("OAuth 凭证 type 必须是 oauth"));
            }
        }
        AuthAccountKind::ApiKey => {
            if account_credential_api_key(&account.credential).is_none() {
                return Err(validation_error("API Key 凭证不能为空"));
            }
        }
    }
    Ok(())
}

fn account_credential_api_key(credential: &Value) -> Option<String> {
    credential
        .get("key")
        .and_then(Value::as_str)
        .or_else(|| credential.get("apiKey").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn create_api_key_credential(api_key: &str) -> Value {
    json!({
        "type": "api_key",
        "key": api_key.trim()
    })
}

fn account_provider_writes_auth(account: &AuthAccount) -> bool {
    is_official_provider_id(&account.provider_id)
}

fn account_api_key_endpoint_matches_pi_models(
    account: &AuthAccount,
    path: &Path,
) -> AppResult<bool> {
    if account.kind != AuthAccountKind::ApiKey {
        return Ok(true);
    }
    let Some(base_url) = account
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(account_provider_writes_auth(account));
    };
    let models = read_json_object(path, "PI_MODELS_READ_FAILED", "models.json")?;
    let Some(provider) = models
        .get("providers")
        .and_then(Value::as_object)
        .and_then(|providers| providers.get(&account.provider_id))
        .and_then(Value::as_object)
    else {
        return Ok(false);
    };
    if provider
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        != Some(base_url)
    {
        return Ok(false);
    }
    if !account_provider_writes_auth(account) {
        let api_key = account_credential_api_key(&account.credential)
            .ok_or_else(|| validation_error("API Key 凭证不能为空"))?;
        return Ok(provider
            .get("apiKey")
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(api_key.as_str()));
    }
    Ok(true)
}

fn overlay_account_endpoint_on_models_value(
    value: &mut Value,
    account: &AuthAccount,
) -> AppResult<bool> {
    if account.kind != AuthAccountKind::ApiKey {
        return Ok(false);
    }
    validate_account_credential(account)?;
    let Some(base_url) = account
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(false);
    };
    if !value.is_object() {
        *value = json!({});
    }
    let object = value
        .as_object_mut()
        .ok_or_else(|| validation_error("models.json 必须是 object"))?;
    if !object.get("providers").is_some_and(Value::is_object) {
        object.insert("providers".to_string(), Value::Object(Map::new()));
    }
    let providers = object
        .get_mut("providers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| validation_error("models.json providers 必须是 object"))?;
    if !providers
        .get(&account.provider_id)
        .is_some_and(Value::is_object)
    {
        providers.insert(account.provider_id.clone(), Value::Object(Map::new()));
    }
    let provider = providers
        .get_mut(&account.provider_id)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| validation_error("models.json provider 必须是 object"))?;
    provider.insert("baseUrl".to_string(), Value::String(base_url.to_string()));
    if !account_provider_writes_auth(account) {
        let api_key = account_credential_api_key(&account.credential)
            .ok_or_else(|| validation_error("API Key 凭证不能为空"))?;
        provider.insert("apiKey".to_string(), Value::String(api_key));
    }
    Ok(true)
}

fn build_account_models_json(account: &AuthAccount, path: &Path) -> AppResult<Option<Value>> {
    if account.kind != AuthAccountKind::ApiKey {
        return Ok(None);
    }
    let mut value = Value::Object(read_json_object(
        path,
        "PI_MODELS_WRITE_FAILED",
        "models.json",
    )?);
    if overlay_account_endpoint_on_models_value(&mut value, account)? {
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn upsert_auth_account(
    store: &mut AccountsStore,
    provider_id: String,
    label: String,
    kind: AuthAccountKind,
    base_url: Option<String>,
    credential: Value,
) -> AppResult<AuthAccount> {
    validate_account_provider_id(&provider_id, &kind)?;
    let base_url = base_url.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    let now = now_timestamp_string();
    if let Some(account) = store.accounts.iter_mut().find(|account| {
        account.provider_id == provider_id
            && account.kind == kind
            && account.base_url == base_url
            && account.credential == credential
    }) {
        account.updated_at = now;
        validate_account_credential(account)?;
        return Ok(account.clone());
    }
    if kind == AuthAccountKind::OAuth {
        if let Some(identity_key) = oauth_identity_key(&credential) {
            if let Some(account) = store.accounts.iter_mut().find(|account| {
                account.provider_id == provider_id
                    && account.kind == AuthAccountKind::OAuth
                    && oauth_identity_key(&account.credential).as_deref()
                        == Some(identity_key.as_str())
            }) {
                account.credential = credential;
                account.updated_at = now;
                validate_account_credential(account)?;
                return Ok(account.clone());
            }
        }
    }
    let account = AuthAccount {
        id: create_account_id(),
        provider_id,
        label: unique_account_label(store, &label),
        kind,
        base_url,
        credential,
        created_at: now.clone(),
        updated_at: now,
        last_applied_at: None,
        active_in_pi: false,
    };
    validate_account_credential(&account)?;
    store.accounts.push(account.clone());
    Ok(account)
}

fn duplicate_auth_account_in_store(
    store: &mut AccountsStore,
    account_id: &str,
) -> AppResult<AuthAccount> {
    let source = store
        .accounts
        .iter()
        .find(|account| account.id == account_id)
        .cloned()
        .ok_or_else(|| validation_error("账号不存在"))?;
    let now = now_timestamp_string();
    let account = AuthAccount {
        id: create_account_id(),
        provider_id: source.provider_id,
        label: unique_account_label(store, &format!("{} Copy", source.label)),
        kind: source.kind,
        base_url: source.base_url,
        credential: source.credential,
        created_at: now.clone(),
        updated_at: now,
        last_applied_at: None,
        active_in_pi: false,
    };
    validate_account_credential(&account)?;
    store.accounts.push(account.clone());
    Ok(account)
}

fn clear_deleted_account_bindings(config: &mut AppConfig, account_id: &str) -> bool {
    let mut changed = false;
    for provider in &mut config.providers {
        let Provider::Official(provider) = provider else {
            continue;
        };
        if provider.auth_account_id.as_deref() == Some(account_id) {
            provider.auth_account_id = None;
            provider.auth_mode = AuthMode::Existing;
            changed = true;
        }
    }
    changed
}

fn clear_deleted_account_bindings_in_config_file(path: &Path, account_id: &str) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(path).map_err(|err| {
        AppError::new("CONFIG_PARSE_FAILED", "读取 GUI 配置失败").with_details(err.to_string())
    })?;
    let mut config: AppConfig = serde_json::from_str(&text).map_err(|err| {
        AppError::new("CONFIG_PARSE_FAILED", "GUI 配置 JSON 无法解析").with_details(err.to_string())
    })?;
    config = normalize_app_config(config);
    if clear_deleted_account_bindings(&mut config, account_id) {
        validate_app_config(&config)?;
        atomic_write_json(path, &config).map_err(|err| err.with_file("config.json", &[]))?;
    }
    Ok(())
}

#[tauri::command]
fn load_app_config() -> AppResult<LoadAppConfigResult> {
    let paths = resolve_paths()?;
    if !paths.app_config_file.exists() {
        return Ok(LoadAppConfigResult {
            config: default_config(),
            resolved_paths: paths_for_frontend(&paths),
        });
    }

    let text = fs::read_to_string(&paths.app_config_file).map_err(|err| {
        AppError::new("CONFIG_PARSE_FAILED", "读取 GUI 配置失败").with_details(err.to_string())
    })?;
    let config: AppConfig = serde_json::from_str(&text).map_err(|err| {
        AppError::new("CONFIG_PARSE_FAILED", "GUI 配置 JSON 无法解析").with_details(err.to_string())
    })?;
    let config = normalize_app_config(config);
    validate_app_config(&config)?;
    Ok(LoadAppConfigResult {
        config,
        resolved_paths: paths_for_frontend(&paths),
    })
}

#[tauri::command]
fn save_app_config(input: SaveAppConfigInput) -> AppResult<()> {
    let config = normalize_app_config(input.config);
    validate_app_config(&config)?;
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.app_config_dir).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "创建 PiSwitch 配置目录失败")
            .with_details(err.to_string())
    })?;
    atomic_write_json(&paths.app_config_file, &config)
        .map_err(|err| err.with_file("config.json", &[]))
}

#[tauri::command]
fn load_auth_accounts() -> AppResult<AccountsView> {
    load_accounts_store().map(|store| accounts_to_view(&store))
}

#[tauri::command]
fn submit_oauth_manual_code(
    sessions: tauri::State<OAuthLoginSessions>,
    input: SubmitOAuthManualCodeInput,
) -> AppResult<()> {
    submit_oauth_manual_code_to_session(&sessions, input)
}

#[tauri::command]
fn create_api_key_account(input: CreateApiKeyAccountInput) -> AppResult<AuthAccountView> {
    let provider_id = input.provider_id.trim();
    validate_account_provider_id(provider_id, &AuthAccountKind::ApiKey)?;
    let base_url = input.base_url.trim();
    if base_url.is_empty() {
        return Err(validation_error("Base URL 不能为空"));
    }
    let api_key = input.api_key.trim();
    if api_key.is_empty() {
        return Err(validation_error("API Key 不能为空"));
    }
    let mut store = load_accounts_store()?;
    let label = normalize_account_label(Some(&input.label), provider_id, AuthAccountKind::ApiKey);
    let mut account = upsert_auth_account(
        &mut store,
        provider_id.to_string(),
        label,
        AuthAccountKind::ApiKey,
        Some(base_url.to_string()),
        create_api_key_credential(api_key),
    )?;
    save_accounts_store(&store)?;
    account.active_in_pi = false;
    Ok(account_to_view(&account))
}

#[tauri::command]
fn rename_auth_account(input: RenameAuthAccountInput) -> AppResult<AuthAccountView> {
    let label = input.label.trim();
    if label.is_empty() {
        return Err(validation_error("账号名称不能为空"));
    }
    let mut store = load_accounts_store()?;
    let account = store
        .accounts
        .iter_mut()
        .find(|account| account.id == input.account_id)
        .ok_or_else(|| validation_error("账号不存在"))?;
    account.label = label.to_string();
    account.updated_at = now_timestamp_string();
    save_accounts_store(&store)?;
    let mut updated_store = load_accounts_store()?;
    let updated = updated_store
        .accounts
        .drain(..)
        .find(|account| account.id == input.account_id)
        .ok_or_else(|| validation_error("账号不存在"))?;
    Ok(account_to_view(&updated))
}

#[tauri::command]
fn delete_auth_account(input: DeleteAuthAccountInput) -> AppResult<()> {
    let paths = resolve_paths()?;
    let mut store = load_accounts_store()?;
    let before = store.accounts.len();
    store
        .accounts
        .retain(|account| account.id != input.account_id);
    if store.accounts.len() == before {
        return Err(validation_error("账号不存在"));
    }
    clear_deleted_account_bindings_in_config_file(&paths.app_config_file, &input.account_id)?;
    save_accounts_store(&store)?;
    Ok(())
}

#[tauri::command]
fn duplicate_auth_account(input: DuplicateAuthAccountInput) -> AppResult<AuthAccountView> {
    let mut store = load_accounts_store()?;
    let account = duplicate_auth_account_in_store(&mut store, &input.account_id)?;
    save_accounts_store(&store)?;
    Ok(account_to_view(&account))
}

#[tauri::command]
fn apply_auth_account(input: ApplyAuthAccountInput) -> AppResult<AuthAccountView> {
    let paths = resolve_paths()?;
    apply_account_to_pi(input, &paths)
}

fn apply_account_to_pi(input: ApplyAuthAccountInput, paths: &Paths) -> AppResult<AuthAccountView> {
    fs::create_dir_all(&paths.pi_agent_dir).map_err(|err| {
        AppError::new("PI_AUTH_WRITE_FAILED", "创建 Pi 配置目录失败").with_details(err.to_string())
    })?;
    let mut store = load_accounts_store_from_path(&paths.accounts_file)?;
    let index = store
        .accounts
        .iter()
        .position(|account| account.id == input.account_id)
        .ok_or_else(|| validation_error("账号不存在"))?;
    let provider_id = store.accounts[index].provider_id.clone();
    let target_is_current = account_matches_current_pi_state(
        &store,
        &input.account_id,
        &paths.pi_auth_file,
        &paths.pi_models_file,
    )?;
    if account_provider_writes_auth(&store.accounts[index]) {
        let _ = sync_current_pi_auth_to_matching_account(
            &mut store,
            &paths.pi_auth_file,
            &provider_id,
            (!target_is_current).then_some(input.account_id.as_str()),
        )?;
    }
    if let Some(models_json) =
        build_account_models_json(&store.accounts[index], &paths.pi_models_file)?
    {
        write_pi_file(
            &paths.pi_models_file,
            &models_json,
            "models.json",
            "PI_MODELS_WRITE_FAILED",
            &[],
        )?;
    }
    write_account_to_pi_auth(&store.accounts[index], &paths.pi_auth_file)?;
    let now = now_timestamp_string();
    store.accounts[index].last_applied_at = Some(now.clone());
    store.accounts[index].updated_at = now;
    let _ =
        annotate_active_accounts_from_paths(&mut store, &paths.pi_auth_file, &paths.pi_models_file);
    let account = store.accounts[index].clone();
    save_accounts_store_to_path(&paths.accounts_file, &store)?;
    Ok(account_to_view(&account))
}

#[tauri::command]
fn import_pi_auth_account(input: ImportPiAuthAccountInput) -> AppResult<AuthAccountView> {
    let provider_id = input.provider_id.trim().to_string();
    validate_official_provider_id(&provider_id)?;
    let paths = resolve_paths()?;
    let auth = read_json_object(&paths.pi_auth_file, "PI_AUTH_READ_FAILED", "auth.json")?;
    let credential = auth
        .get(&provider_id)
        .cloned()
        .ok_or_else(|| validation_error("Pi auth.json 中没有该供应商认证"))?;
    let kind = match credential.get("type").and_then(Value::as_str) {
        Some("oauth") => AuthAccountKind::OAuth,
        Some("api_key") => AuthAccountKind::ApiKey,
        _ => return Err(validation_error("无法识别该供应商认证类型")),
    };
    let mut store = load_accounts_store_from_path(&paths.accounts_file)?;
    let label = normalize_account_label_for_credential(
        input.label.as_deref(),
        &provider_id,
        kind.clone(),
        &credential,
    );
    let mut account = upsert_auth_account(&mut store, provider_id, label, kind, None, credential)?;
    save_accounts_store_to_path(&paths.accounts_file, &store)?;
    account.active_in_pi = true;
    Ok(account_to_view(&account))
}

#[tauri::command]
fn apply_provider_to_pi(input: ApplyProviderInput) -> AppResult<()> {
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.pi_agent_dir).map_err(|err| {
        AppError::new("PI_MODELS_WRITE_FAILED", "创建 Pi 配置目录失败")
            .with_details(err.to_string())
    })?;
    let config = normalize_app_config(input.config);
    apply_provider(&config, &input.provider_entry_id, &paths)?;
    Ok(())
}

#[tauri::command]
async fn test_provider(input: TestProviderInput) -> AppResult<TestProviderResult> {
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.pi_agent_dir).map_err(|err| {
        AppError::new("PI_MODELS_WRITE_FAILED", "创建 Pi 配置目录失败")
            .with_details(err.to_string())
    })?;
    let config = normalize_app_config(input.config);
    apply_provider(&config, &input.provider_entry_id, &paths)?;
    let provider = config
        .providers
        .iter()
        .find(|provider| self::provider_entry_id(provider) == input.provider_entry_id)
        .ok_or_else(|| validation_error("找不到要测试的供应商"))?;
    run_pi_ping(
        &paths.home,
        &provider_id(provider),
        default_model_id(provider),
    )
    .await
}

#[tauri::command]
async fn fetch_custom_provider_models(
    input: FetchCustomProviderModelsInput,
) -> AppResult<FetchCustomProviderModelsResult> {
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    let api_key = input.api_key.trim().to_string();
    if base_url.is_empty() || api_key.is_empty() {
        return Err(AppError::new(
            "MODEL_FETCH_FAILED",
            "Base URL 和 API Key 不能为空",
        ));
    }

    let client = reqwest::Client::new();
    let urls = model_fetch_urls(&base_url);
    let mut errors = Vec::new();
    for url in &urls {
        match fetch_models_from_url(&client, url, &api_key).await {
            Ok(models) => return Ok(FetchCustomProviderModelsResult { models }),
            Err(err) => errors.push(format!("{url}: {}", err.message_with_details())),
        }
    }

    Err(
        AppError::new("MODEL_FETCH_FAILED", "拉取模型失败").with_details(format!(
            "已尝试: {}\n{}",
            urls.join(", "),
            errors.join("\n")
        )),
    )
}

fn model_fetch_urls(base_url: &str) -> Vec<String> {
    let mut urls = vec![format!("{base_url}/models")];
    if !base_url
        .rsplit('/')
        .next()
        .is_some_and(|segment| segment.eq_ignore_ascii_case("v1"))
    {
        urls.push(format!("{base_url}/v1/models"));
    }
    urls
}

async fn fetch_models_from_url(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> AppResult<Vec<String>> {
    let response = client
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|err| {
            AppError::new("MODEL_FETCH_FAILED", "请求模型列表失败").with_details(err.to_string())
        })?
        .error_for_status()
        .map_err(|err| {
            AppError::new("MODEL_FETCH_FAILED", "模型列表返回错误状态")
                .with_details(err.to_string())
        })?;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let value: Value = response.json().await.map_err(|err| {
        AppError::new("MODEL_FETCH_FAILED", "模型列表响应不是可解析 JSON")
            .with_details(format!("{err}; content-type: {content_type}"))
    })?;

    let mut models = parse_openai_model_list(&value)?;
    models.sort();
    models.dedup();
    Ok(models)
}

fn parse_openai_model_list(value: &Value) -> AppResult<Vec<String>> {
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("MODEL_FETCH_FAILED", "模型列表响应缺少 data 数组"))?
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Err(AppError::new(
            "MODEL_FETCH_FAILED",
            "模型列表响应没有可用模型 ID",
        ));
    }
    Ok(models)
}

#[tauri::command]
async fn list_pi_models(input: ListPiModelsInput) -> AppResult<ListPiModelsResult> {
    match list_pi_models_via_cli(&input.provider_id).await {
        Ok(models) => return Ok(ListPiModelsResult { models }),
        Err(cli_err) => list_pi_models_via_registry(input)
            .await
            .map_err(|registry_err| {
                AppError::new("PI_MODEL_REGISTRY_FAILED", "读取 Pi 模型列表失败").with_details(
                    format!(
                        "pi --list-models 失败: {}\nregistry fallback 失败: {}",
                        cli_err.message_with_details(),
                        registry_err.message_with_details()
                    ),
                )
            }),
    }
}

async fn list_pi_models_via_cli(provider_id: &str) -> AppResult<Vec<PiModelInfo>> {
    let output = Command::new("pi")
        .arg("--list-models")
        .arg(provider_id)
        .arg("--offline")
        .output()
        .await
        .map_err(|err| {
            AppError::new("PI_COMMAND_NOT_FOUND", "无法启动 pi 读取模型列表")
                .with_details(err.to_string())
        })?;
    if !output.status.success() {
        return Err(
            AppError::new("PI_MODEL_LIST_FAILED", "pi --list-models 执行失败")
                .with_details(String::from_utf8_lossy(&output.stderr).to_string()),
        );
    }
    parse_pi_models_table(&String::from_utf8_lossy(&output.stdout), provider_id)
}

async fn list_pi_models_via_registry(input: ListPiModelsInput) -> AppResult<ListPiModelsResult> {
    let pi_path = find_pi_command_path().await?;
    let package_index = pi_path
        .parent()
        .and_then(Path::parent)
        .map(|package_dir| package_dir.join("dist").join("index.js"))
        .filter(|path| path.exists())
        .ok_or_else(|| {
            AppError::new("PI_PACKAGE_NOT_FOUND", "无法定位 Pi 模型注册表")
                .with_details(pi_path.display().to_string())
        })?;
    let script = format!(
        r#"
const mod = await import({package_index});
const {{ ModelRegistry, AuthStorage }} = mod;
const providerId = {provider_id};
const apiKey = {api_key};
const auth = AuthStorage.create();
if (apiKey) auth.setRuntimeApiKey(providerId, apiKey);
const registry = ModelRegistry.create(auth);
const models = registry.getAvailable()
  .filter((model) => model.provider === providerId)
  .map((model) => ({{
  provider: model.provider,
  id: model.id,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  reasoning: model.reasoning,
  input: model.input,
  }}));
console.log(JSON.stringify(models));
"#,
        package_index = serde_json::to_string(&format!("file://{}", package_index.display()))
            .unwrap_or_default(),
        provider_id = serde_json::to_string(&input.provider_id).unwrap_or_default(),
        api_key = serde_json::to_string(&input.api_key.filter(|key| !key.trim().is_empty()))
            .unwrap_or_else(|_| "null".to_string())
    );
    let output = Command::new("node")
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .output()
        .await
        .map_err(|err| {
            AppError::new("NODE_COMMAND_NOT_FOUND", "无法启动 node 读取 Pi 模型注册表")
                .with_details(err.to_string())
        })?;
    if !output.status.success() {
        return Err(
            AppError::new("PI_MODEL_REGISTRY_FAILED", "读取 Pi 模型注册表失败")
                .with_details(String::from_utf8_lossy(&output.stderr).to_string()),
        );
    }
    parse_pi_models_json(&String::from_utf8_lossy(&output.stdout))
        .map(|models| ListPiModelsResult { models })
}

#[tauri::command]
async fn login_official_provider_oauth(
    window: tauri::Window,
    sessions: tauri::State<'_, OAuthLoginSessions>,
    input: LoginOfficialProviderOAuthInput,
) -> AppResult<LoginOfficialProviderOAuthResult> {
    if !matches!(
        input.provider_id.as_str(),
        "anthropic" | "github-copilot" | "openai-codex"
    ) {
        return Err(validation_error("当前官方供应商不支持 OAuth 登录"));
    }

    let pi_path = find_pi_command_path().await?;
    let package_index = pi_path
        .parent()
        .and_then(Path::parent)
        .map(|package_dir| package_dir.join("dist").join("index.js"))
        .filter(|path| path.exists())
        .ok_or_else(|| {
            AppError::new("PI_PACKAGE_NOT_FOUND", "无法定位 Pi OAuth 模块")
                .with_details(pi_path.display().to_string())
        })?;

    let temp_dir = tempfile::tempdir().map_err(|err| {
        AppError::new("OAUTH_LOGIN_FAILED", "创建临时 OAuth 目录失败").with_details(err.to_string())
    })?;
    let temp_auth_file = temp_dir.path().join("auth.json");
    let manual_code_file = temp_dir.path().join("manual-code.txt");
    let login_id = create_oauth_login_id();
    let session_guard =
        OAuthLoginSessionGuard::register(&sessions, login_id.clone(), manual_code_file.clone())?;

    let script = oauth_login_script(
        &package_index,
        &input.provider_id,
        &temp_auth_file,
        &login_id,
        &manual_code_file,
    );
    let mut child = Command::new("node")
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            AppError::new("NODE_COMMAND_NOT_FOUND", "无法启动 node 执行 OAuth 登录")
                .with_details(err.to_string())
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("OAUTH_LOGIN_FAILED", "无法读取 OAuth 登录输出"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::new("OAUTH_LOGIN_FAILED", "无法读取 OAuth 登录错误输出"))?;
    let mut stderr_task = tokio::spawn(async move {
        let mut output = Vec::new();
        let _ = stderr.read_to_end(&mut output).await;
        String::from_utf8_lossy(&output).to_string()
    });

    let mut reader = tokio::io::BufReader::new(stdout);
    let mut line = String::new();
    let mut provider_name = input.provider_id.clone();
    loop {
        line.clear();
        let read = reader.read_line(&mut line).await.map_err(|err| {
            AppError::new("OAUTH_LOGIN_FAILED", "读取 OAuth 登录输出失败")
                .with_details(err.to_string())
        })?;
        if read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event: OAuthEvent = serde_json::from_str(trimmed).map_err(|err| {
            AppError::new("OAUTH_LOGIN_FAILED", "OAuth 登录输出无法解析")
                .with_details(format!("{trimmed}: {err}"))
        })?;
        if let Some(name) = &event.provider_name {
            provider_name = name.clone();
        }
        let _ = window.emit("oauth-login-event", event);
    }

    let status = child.wait().await.map_err(|err| {
        AppError::new("OAUTH_LOGIN_FAILED", "等待 OAuth 登录进程失败").with_details(err.to_string())
    })?;
    session_guard.cleanup();
    let stderr_text = match timeout(Duration::from_secs(2), &mut stderr_task).await {
        Ok(Ok(text)) => text,
        _ => String::new(),
    };
    if !status.success() {
        return Err(AppError::new("OAUTH_LOGIN_FAILED", "OAuth 登录失败")
            .with_details(stderr_text.trim().to_string()));
    }

    let auth = read_json_object(&temp_auth_file, "OAUTH_LOGIN_FAILED", "临时 auth.json")?;
    let credential = auth
        .get(&input.provider_id)
        .cloned()
        .ok_or_else(|| AppError::new("OAUTH_LOGIN_FAILED", "OAuth 登录未生成凭证"))?;
    let mut store = load_accounts_store()?;
    let label = normalize_account_label_for_credential(
        input.label.as_deref(),
        &input.provider_id,
        AuthAccountKind::OAuth,
        &credential,
    );
    let account = upsert_auth_account(
        &mut store,
        input.provider_id,
        label,
        AuthAccountKind::OAuth,
        None,
        credential,
    )?;
    save_accounts_store(&store)?;

    Ok(LoginOfficialProviderOAuthResult {
        account: account_to_view(&account),
        provider_name,
    })
}

fn oauth_login_script(
    package_index: &Path,
    provider_id: &str,
    auth_path: &Path,
    login_id: &str,
    manual_code_path: &Path,
) -> String {
    format!(
        r#"
import fs from "node:fs/promises";
const mod = await import({package_index});
const providerId = {provider_id};
const loginId = {login_id};
const manualCodePath = {manual_code_path};
const auth = mod.AuthStorage.create({auth_path});
const provider = auth.getOAuthProviders().find((item) => item.id === providerId);
function emit(event) {{
  process.stdout.write(JSON.stringify({{ loginId, providerId, providerName: provider?.name, ...event }}) + "\n");
}}
async function waitForManualCode() {{
  emit({{ type: "manualCode", message: "Paste the final redirect URL or authorization code." }});
  while (true) {{
    try {{
      const value = (await fs.readFile(manualCodePath, "utf8")).trim();
      if (value) {{
        await fs.unlink(manualCodePath).catch(() => {{}});
        return value;
      }}
    }} catch (error) {{
      if (error?.code !== "ENOENT") throw error;
    }}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }}
}}
if (!provider) {{
  throw new Error(`Unsupported OAuth provider: ${{providerId}}`);
}}
emit({{ type: "started", message: `Starting OAuth login for ${{provider.name}}` }});
await auth.login(providerId, {{
  onAuth: (info) => emit({{ type: "auth", url: info.url, instructions: info.instructions }}),
  onDeviceCode: (info) => emit({{
    type: "deviceCode",
    verificationUri: info.verificationUri,
    userCode: info.userCode,
    intervalSeconds: info.intervalSeconds,
    expiresInSeconds: info.expiresInSeconds,
  }}),
  onPrompt: async (prompt) => {{
    emit({{ type: "prompt", message: prompt.message, placeholder: prompt.placeholder, allowEmpty: prompt.allowEmpty }});
    return "";
  }},
  onSelect: async (prompt) => {{
    const selected = providerId === "openai-codex" ? "browser" : prompt.options?.[0]?.id;
    emit({{ type: "select", message: prompt.message, selected }});
    return selected;
  }},
  onProgress: (message) => emit({{ type: "progress", message }}),
  onManualCodeInput: waitForManualCode,
}});
emit({{ type: "success", message: `Logged in to ${{provider.name}}` }});
"#,
        package_index = serde_json::to_string(&format!("file://{}", package_index.display()))
            .unwrap_or_default(),
        provider_id = serde_json::to_string(provider_id).unwrap_or_default(),
        auth_path = serde_json::to_string(&auth_path.display().to_string()).unwrap_or_default(),
        login_id = serde_json::to_string(login_id).unwrap_or_default(),
        manual_code_path =
            serde_json::to_string(&manual_code_path.display().to_string()).unwrap_or_default()
    )
}

fn validate_app_config(config: &AppConfig) -> AppResult<()> {
    validate_app_config_provider_ids(config)?;

    for provider in &config.providers {
        validate_provider(provider)?;
    }

    if let Some(active_id) = &config.active_provider_id {
        if !config
            .providers
            .iter()
            .any(|provider| provider_entry_id(provider) == active_id)
        {
            return Err(validation_error("activeProviderId 必须匹配现有供应商"));
        }
    }
    Ok(())
}

fn validate_app_config_provider_ids(config: &AppConfig) -> AppResult<()> {
    if config.schema_version != SCHEMA_VERSION {
        return Err(AppError::new(
            "UNSUPPORTED_SCHEMA_VERSION",
            format!("不支持的 schemaVersion: {}", config.schema_version),
        ));
    }

    let mut ids = HashSet::new();
    for provider in &config.providers {
        let id = provider_entry_id(provider);
        if id.is_empty() {
            return Err(validation_error("供应商条目 ID 不能为空"));
        }
        if !ids.insert(id.to_string()) {
            return Err(validation_error(format!("供应商条目 ID 重复: {id}")));
        }
    }
    Ok(())
}

fn validate_provider(provider: &Provider) -> AppResult<()> {
    let (name, models, default_model_id) = match provider {
        Provider::Official(provider) => (
            provider.name.as_str(),
            &provider.models,
            provider.default_model_id.as_str(),
        ),
        Provider::Custom(provider) => (
            provider.name.as_str(),
            &provider.models,
            provider.default_model_id.as_str(),
        ),
    };

    if name.trim().is_empty() {
        return Err(validation_error("供应商名称不能为空"));
    }
    if enabled_models(models).is_empty() {
        return Err(validation_error("模型列表至少需要一个模型"));
    }
    if !enabled_models(models)
        .iter()
        .any(|model| model.id.trim() == default_model_id)
    {
        return Err(validation_error("默认模型必须存在于模型列表中"));
    }
    validate_models(models)?;

    match provider {
        Provider::Official(provider) => {
            if !OFFICIAL_PROVIDER_IDS.contains(&provider.provider_id.as_str()) {
                return Err(validation_error("未知官方供应商"));
            }
            if matches!(provider.auth_mode, AuthMode::ApiKey) && provider.api_key.trim().is_empty()
            {
                return Err(validation_error("API Key 不能为空"));
            }
            if matches!(provider.auth_mode, AuthMode::Account)
                && provider
                    .auth_account_id
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
            {
                return Err(validation_error("请选择认证账号"));
            }
            if let Some(advanced) = &provider.advanced {
                validate_provider_advanced(advanced)?;
            }
        }
        Provider::Custom(provider) => {
            if provider.api_key.trim().is_empty() {
                return Err(validation_error("API Key 不能为空"));
            }
            let provider_id = provider_id(&Provider::Custom(provider.clone()));
            if OFFICIAL_PROVIDER_IDS.contains(&provider_id.as_str()) {
                return Err(validation_error("供应商名称不能与内置供应商冲突"));
            }
            if provider.base_url.trim().is_empty() {
                return Err(validation_error("Base URL 不能为空"));
            }
            if provider.api.is_empty() {
                return Err(validation_error("API 类型不能为空"));
            }
            validate_headers(provider.headers.as_deref())?;
            if let Some(compat) = &provider.compat {
                let _ = compat_to_value(compat);
            }
        }
    };
    Ok(())
}

fn validate_provider_advanced(advanced: &ProviderAdvancedConfig) -> AppResult<()> {
    validate_headers(advanced.headers.as_deref())?;
    if let Some(api) = &advanced.api {
        if api.trim().is_empty() {
            return Err(validation_error("API 类型不能为空"));
        }
    }
    if let Some(compat) = &advanced.compat {
        let _ = compat_to_value(compat);
    }
    Ok(())
}

fn validate_models(models: &[ModelConfig]) -> AppResult<()> {
    let mut ids = HashSet::new();
    for model in models {
        let id = model.id.trim();
        if id.is_empty() {
            return Err(validation_error("模型 ID 不能为空"));
        }
        if !ids.insert(id.to_string()) {
            return Err(validation_error(format!("模型 ID 重复: {id}")));
        }
        if let Some(context_window) = model.context_window {
            if context_window == 0 {
                return Err(validation_error("contextWindow 必须大于 0"));
            }
        }
        if let Some(max_tokens) = model.max_tokens {
            if max_tokens == 0 {
                return Err(validation_error("maxTokens 必须大于 0"));
            }
        }
        if let Some(cost) = &model.cost {
            validate_non_negative(cost.input, "cost.input")?;
            validate_non_negative(cost.output, "cost.output")?;
            validate_non_negative(cost.cache_read, "cost.cacheRead")?;
            validate_non_negative(cost.cache_write, "cost.cacheWrite")?;
        }
        validate_headers(model.headers.as_deref())?;
        if let Some(api) = &model.api {
            if api.trim().is_empty() {
                return Err(validation_error("模型 API 类型不能为空"));
            }
        }
        if let Some(input) = &model.input {
            for item in input {
                if item != "text" && item != "image" {
                    return Err(validation_error("input 只支持 text/image"));
                }
            }
        }
    }
    Ok(())
}

fn validate_non_negative(value: Option<f64>, field: &str) -> AppResult<()> {
    if let Some(value) = value {
        if !value.is_finite() || value < 0.0 {
            return Err(validation_error(format!("{field} 必须是非负数字")));
        }
    }
    Ok(())
}

fn validate_headers(headers: Option<&[HeaderEntry]>) -> AppResult<()> {
    for header in headers.unwrap_or_default() {
        if header.key.trim().is_empty() {
            return Err(validation_error("Header 名称不能为空"));
        }
    }
    Ok(())
}

fn enabled_models(models: &[ModelConfig]) -> Vec<&ModelConfig> {
    models.iter().collect()
}

fn validation_error(message: impl Into<String>) -> AppError {
    AppError::new("VALIDATION_FAILED", message)
}

fn normalize_app_config(mut config: AppConfig) -> AppConfig {
    config.schema_version = SCHEMA_VERSION;
    config.providers = config
        .providers
        .into_iter()
        .map(normalize_provider)
        .collect();
    config
}

fn normalize_provider(provider: Provider) -> Provider {
    match provider {
        Provider::Official(mut provider) => {
            provider.api_key = provider.api_key.trim().to_string();
            provider.models = provider.models.into_iter().map(normalize_model).collect();
            Provider::Official(provider)
        }
        Provider::Custom(mut provider) => {
            provider.base_url = provider.base_url.trim().to_string();
            provider.api_key = provider.api_key.trim().to_string();
            provider.models = provider.models.into_iter().map(normalize_model).collect();
            Provider::Custom(provider)
        }
    }
}

fn normalize_model(mut model: ModelConfig) -> ModelConfig {
    model.id = model.id.trim().to_string();
    model.name = model.name.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    model.api = model.api.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    model
}

fn provider_entry_id(provider: &Provider) -> &str {
    match provider {
        Provider::Official(provider) => &provider.id,
        Provider::Custom(provider) => &provider.id,
    }
}

fn provider_id(provider: &Provider) -> String {
    match provider {
        Provider::Official(provider) => provider.provider_id.clone(),
        Provider::Custom(provider) => {
            let provider_id = sanitize_provider_id(&provider.name);
            if provider_id.is_empty() {
                provider.id.clone()
            } else {
                provider_id
            }
        }
    }
}

fn default_model_id(provider: &Provider) -> &str {
    match provider {
        Provider::Official(provider) => &provider.default_model_id,
        Provider::Custom(provider) => &provider.default_model_id,
    }
}

fn sanitize_provider_id(value: &str) -> String {
    value.chars().filter(|char| !char.is_whitespace()).collect()
}

fn apply_provider(config: &AppConfig, provider_entry_id: &str, paths: &Paths) -> AppResult<()> {
    validate_app_config_provider_ids(config)?;
    let provider = config
        .providers
        .iter()
        .find(|provider| self::provider_entry_id(provider) == provider_entry_id)
        .ok_or_else(|| validation_error("找不到要应用的供应商"))?;
    validate_provider(provider)?;

    let models_json = build_models_json(provider);
    let mut accounts = load_accounts_store_from_path(&paths.accounts_file)?;
    let mut accounts_changed = false;
    if let Some(replacing_provider_id) = provider_replaces_auth_provider_id(provider) {
        let provider_account_id = provider_auth_account_id(provider);
        let target_is_current = match provider_account_id {
            Some(account_id) => {
                account_matches_current_pi_auth(&accounts, account_id, &paths.pi_auth_file)?
            }
            None => false,
        };
        accounts_changed |= sync_current_pi_auth_to_matching_account(
            &mut accounts,
            &paths.pi_auth_file,
            &replacing_provider_id,
            provider_account_id.filter(|_| !target_is_current),
        )?;
    }
    let auth_json = build_auth_json(provider, &paths.pi_auth_file, Some(&accounts))?;
    let settings_json = build_settings_json(provider, &paths.pi_settings_file)?;
    validate_pi_json(provider, &models_json, &auth_json, &settings_json)?;

    let mut written = Vec::new();
    write_pi_file(
        &paths.pi_models_file,
        &models_json,
        "models.json",
        "PI_MODELS_WRITE_FAILED",
        &written,
    )?;
    written.push("models.json".to_string());
    write_pi_file(
        &paths.pi_auth_file,
        &auth_json,
        "auth.json",
        "PI_AUTH_WRITE_FAILED",
        &written,
    )?;
    written.push("auth.json".to_string());
    write_pi_file(
        &paths.pi_settings_file,
        &settings_json,
        "settings.json",
        "PI_SETTINGS_WRITE_FAILED",
        &written,
    )?;
    accounts_changed |= mark_provider_account_applied(provider, &mut accounts);
    if accounts_changed {
        save_accounts_store_to_path(&paths.accounts_file, &accounts)?;
    }
    Ok(())
}

fn provider_replaces_auth_provider_id(provider: &Provider) -> Option<String> {
    let Provider::Official(provider) = provider else {
        return None;
    };
    matches!(provider.auth_mode, AuthMode::ApiKey | AuthMode::Account)
        .then(|| provider.provider_id.clone())
}

fn provider_auth_account_id(provider: &Provider) -> Option<&str> {
    let Provider::Official(provider) = provider else {
        return None;
    };
    if matches!(provider.auth_mode, AuthMode::Account) {
        return provider.auth_account_id.as_deref();
    }
    None
}

fn mark_provider_account_applied(provider: &Provider, accounts: &mut AccountsStore) -> bool {
    let Provider::Official(provider) = provider else {
        return false;
    };
    if !matches!(provider.auth_mode, AuthMode::Account) {
        return false;
    }
    let Some(account_id) = provider.auth_account_id.as_deref() else {
        return false;
    };
    let Some(account) = accounts
        .accounts
        .iter_mut()
        .find(|account| account.id == account_id)
    else {
        return false;
    };
    let now = now_timestamp_string();
    account.last_applied_at = Some(now.clone());
    account.updated_at = now;
    true
}

fn build_models_json(provider: &Provider) -> Value {
    match provider {
        Provider::Official(provider) => {
            let mut provider_object = Map::new();
            if let Some(advanced) = &provider.advanced {
                insert_trimmed_string(
                    &mut provider_object,
                    "baseUrl",
                    advanced.base_url.as_deref(),
                );
                insert_trimmed_string(&mut provider_object, "api", advanced.api.as_deref());
                insert_trimmed_string(&mut provider_object, "apiKey", advanced.api_key.as_deref());
                insert_headers(&mut provider_object, advanced.headers.as_deref());
                insert_bool(&mut provider_object, "authHeader", advanced.auth_header);
                if let Some(compat) = &advanced.compat {
                    if let Some(value) = compat_to_value(compat) {
                        provider_object.insert("compat".to_string(), value);
                    }
                }
            }

            let custom_models = provider
                .models
                .iter()
                .filter(|model| {
                    model.source == Some(ModelSource::Custom)
                        || (!model.override_built_in.unwrap_or(false)
                            && model.source != Some(ModelSource::Builtin))
                })
                .filter_map(model_to_value)
                .collect::<Vec<_>>();
            if !custom_models.is_empty() {
                provider_object.insert("models".to_string(), Value::Array(custom_models));
            }

            let mut overrides = Map::new();
            for model in provider
                .models
                .iter()
                .filter(|model| model.override_built_in.unwrap_or(false))
            {
                if let Some(value) = model_override_to_value(model) {
                    overrides.insert(model.id.trim().to_string(), value);
                }
            }
            if !overrides.is_empty() {
                provider_object.insert("modelOverrides".to_string(), Value::Object(overrides));
            }

            let mut providers = Map::new();
            if !provider_object.is_empty() {
                providers.insert(provider.provider_id.clone(), Value::Object(provider_object));
            }
            json!({ "providers": providers })
        }
        Provider::Custom(provider) => {
            let provider_id = provider_id(&Provider::Custom(provider.clone()));
            let mut provider_object = Map::new();
            provider_object.insert(
                "baseUrl".to_string(),
                Value::String(provider.base_url.trim().to_string()),
            );
            provider_object.insert("api".to_string(), Value::String(provider.api.clone()));
            provider_object.insert(
                "apiKey".to_string(),
                Value::String(provider.api_key.trim().to_string()),
            );
            insert_headers(&mut provider_object, provider.headers.as_deref());
            insert_bool(&mut provider_object, "authHeader", provider.auth_header);
            if let Some(compat) = &provider.compat {
                if let Some(value) = compat_to_value(compat) {
                    provider_object.insert("compat".to_string(), value);
                }
            }
            provider_object.insert(
                "models".to_string(),
                Value::Array(
                    provider
                        .models
                        .iter()
                        .filter(|model| !model.override_built_in.unwrap_or(false))
                        .filter_map(model_to_value)
                        .collect(),
                ),
            );
            let mut providers = Map::new();
            providers.insert(provider_id, Value::Object(provider_object));
            json!({ "providers": providers })
        }
    }
}

fn build_auth_json(
    provider: &Provider,
    path: &Path,
    accounts: Option<&AccountsStore>,
) -> AppResult<Value> {
    let mut auth = read_json_object(path, "PI_AUTH_WRITE_FAILED", "auth.json")?;
    if let Provider::Official(provider) = provider {
        match provider.auth_mode {
            AuthMode::ApiKey => {
                auth.insert(
                    provider.provider_id.clone(),
                    create_api_key_credential(&provider.api_key),
                );
            }
            AuthMode::Account => {
                let account_id = provider
                    .auth_account_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| validation_error("请选择认证账号"))?;
                let account = accounts
                    .ok_or_else(|| validation_error("账号库未加载"))?
                    .accounts
                    .iter()
                    .find(|account| account.id == account_id)
                    .ok_or_else(|| validation_error("认证账号不存在"))?;
                if account.provider_id != provider.provider_id {
                    return Err(validation_error("认证账号与供应商不匹配"));
                }
                validate_account_credential(account)?;
                auth.insert(provider.provider_id.clone(), account.credential.clone());
            }
            AuthMode::Existing => {}
        }
    }
    Ok(Value::Object(auth))
}

fn write_account_to_pi_auth(account: &AuthAccount, path: &Path) -> AppResult<()> {
    validate_account_credential(account)?;
    if !account_provider_writes_auth(account) {
        return Ok(());
    }
    let mut auth = read_json_object(path, "PI_AUTH_WRITE_FAILED", "auth.json")?;
    auth.insert(account.provider_id.clone(), account.credential.clone());
    atomic_write_json(path, &Value::Object(auth)).map_err(|err| {
        AppError::new("PI_AUTH_WRITE_FAILED", "写入 auth.json 失败")
            .with_details(err.message_with_details())
    })
}

fn build_settings_json(provider: &Provider, path: &Path) -> AppResult<Value> {
    let mut settings = read_json_object(path, "PI_SETTINGS_WRITE_FAILED", "settings.json")?;
    settings.insert(
        "defaultProvider".to_string(),
        Value::String(provider_id(provider)),
    );
    settings.insert(
        "defaultModel".to_string(),
        Value::String(match provider {
            Provider::Official(provider) => provider.default_model_id.clone(),
            Provider::Custom(provider) => provider.default_model_id.clone(),
        }),
    );
    settings.insert(
        "enabledModels".to_string(),
        Value::Array(
            enabled_models(match provider {
                Provider::Official(provider) => &provider.models,
                Provider::Custom(provider) => &provider.models,
            })
            .iter()
            .map(|model| Value::String(model.id.trim().to_string()))
            .collect(),
        ),
    );
    Ok(Value::Object(settings))
}

fn model_to_value(model: &ModelConfig) -> Option<Value> {
    let mut object = Map::new();
    object.insert("id".to_string(), Value::String(model.id.trim().to_string()));
    insert_model_optional_fields(&mut object, model, true);
    Some(Value::Object(object))
}

fn model_override_to_value(model: &ModelConfig) -> Option<Value> {
    let mut object = Map::new();
    insert_model_optional_fields(&mut object, model, false);
    (!object.is_empty()).then_some(Value::Object(object))
}

fn insert_model_optional_fields(
    object: &mut Map<String, Value>,
    model: &ModelConfig,
    include_api: bool,
) {
    insert_trimmed_string(object, "name", model.name.as_deref());
    if include_api {
        insert_trimmed_string(object, "api", model.api.as_deref());
    }
    insert_bool(object, "reasoning", model.reasoning);
    if let Some(input) = &model.input {
        let values = input
            .iter()
            .filter_map(|item| {
                let trimmed = item.trim();
                (!trimmed.is_empty()).then(|| Value::String(trimmed.to_string()))
            })
            .collect::<Vec<_>>();
        if !values.is_empty() {
            object.insert("input".to_string(), Value::Array(values));
        }
    }
    if let Some(value) = model.context_window {
        object.insert("contextWindow".to_string(), json!(value));
    }
    if let Some(value) = model.max_tokens {
        object.insert("maxTokens".to_string(), json!(value));
    }
    if let Some(cost) = &model.cost {
        if let Some(value) = cost_to_value(cost) {
            object.insert("cost".to_string(), value);
        }
    }
    insert_headers(object, model.headers.as_deref());
    if let Some(compat) = &model.compat {
        if let Some(value) = compat_to_value(compat) {
            object.insert("compat".to_string(), value);
        }
    }
    if let Some(map) = &model.thinking_level_map {
        let mut value = Map::new();
        for key in ["off", "minimal", "low", "medium", "high", "xhigh"] {
            if let Some(level_value) = map.get(key) {
                value.insert(
                    key.to_string(),
                    level_value
                        .as_ref()
                        .map(|item| Value::String(item.clone()))
                        .unwrap_or(Value::Null),
                );
            }
        }
        if !value.is_empty() {
            object.insert("thinkingLevelMap".to_string(), Value::Object(value));
        }
    }
}

fn cost_to_value(cost: &CostConfig) -> Option<Value> {
    let mut object = Map::new();
    insert_f64(&mut object, "input", cost.input);
    insert_f64(&mut object, "output", cost.output);
    insert_f64(&mut object, "cacheRead", cost.cache_read);
    insert_f64(&mut object, "cacheWrite", cost.cache_write);
    (!object.is_empty()).then_some(Value::Object(object))
}

fn headers_to_value(headers: &[HeaderEntry]) -> Option<Value> {
    let mut object = Map::new();
    for header in headers {
        let key = header.key.trim();
        if !key.is_empty() {
            object.insert(key.to_string(), Value::String(header.value.clone()));
        }
    }
    (!object.is_empty()).then_some(Value::Object(object))
}

fn compat_to_value(compat: &CompatConfig) -> Option<Value> {
    let mut object = Map::new();
    insert_bool(&mut object, "supportsStore", compat.supports_store);
    insert_bool(
        &mut object,
        "supportsDeveloperRole",
        compat.supports_developer_role,
    );
    insert_bool(
        &mut object,
        "supportsReasoningEffort",
        compat.supports_reasoning_effort,
    );
    insert_bool(
        &mut object,
        "supportsUsageInStreaming",
        compat.supports_usage_in_streaming,
    );
    insert_trimmed_string(
        &mut object,
        "maxTokensField",
        compat.max_tokens_field.as_deref(),
    );
    insert_bool(
        &mut object,
        "requiresToolResultName",
        compat.requires_tool_result_name,
    );
    insert_bool(
        &mut object,
        "requiresAssistantAfterToolResult",
        compat.requires_assistant_after_tool_result,
    );
    insert_bool(
        &mut object,
        "requiresThinkingAsText",
        compat.requires_thinking_as_text,
    );
    insert_bool(
        &mut object,
        "requiresReasoningContentOnAssistantMessages",
        compat.requires_reasoning_content_on_assistant_messages,
    );
    insert_trimmed_string(
        &mut object,
        "thinkingFormat",
        compat.thinking_format.as_deref(),
    );
    insert_bool(&mut object, "zaiToolStream", compat.zai_tool_stream);
    insert_bool(
        &mut object,
        "supportsStrictMode",
        compat.supports_strict_mode,
    );
    insert_trimmed_string(
        &mut object,
        "cacheControlFormat",
        compat.cache_control_format.as_deref(),
    );
    insert_bool(
        &mut object,
        "sendSessionAffinityHeaders",
        compat.send_session_affinity_headers,
    );
    insert_bool(
        &mut object,
        "supportsLongCacheRetention",
        compat.supports_long_cache_retention,
    );
    insert_bool(
        &mut object,
        "sendSessionIdHeader",
        compat.send_session_id_header,
    );
    insert_bool(
        &mut object,
        "supportsEagerToolInputStreaming",
        compat.supports_eager_tool_input_streaming,
    );
    insert_bool(
        &mut object,
        "supportsCacheControlOnTools",
        compat.supports_cache_control_on_tools,
    );
    insert_bool(
        &mut object,
        "supportsTemperature",
        compat.supports_temperature,
    );
    insert_bool(
        &mut object,
        "forceAdaptiveThinking",
        compat.force_adaptive_thinking,
    );
    insert_bool(
        &mut object,
        "allowEmptySignature",
        compat.allow_empty_signature,
    );
    if let Some(routing) = &compat.open_router_routing {
        if let Some(value) = open_router_routing_to_value(routing) {
            object.insert("openRouterRouting".to_string(), value);
        }
    }
    if let Some(routing) = &compat.vercel_gateway_routing {
        if let Some(value) = vercel_gateway_routing_to_value(routing) {
            object.insert("vercelGatewayRouting".to_string(), value);
        }
    }
    (!object.is_empty()).then_some(Value::Object(object))
}

fn open_router_routing_to_value(routing: &OpenRouterRouting) -> Option<Value> {
    let mut object = Map::new();
    insert_bool(&mut object, "allow_fallbacks", routing.allow_fallbacks);
    insert_bool(
        &mut object,
        "require_parameters",
        routing.require_parameters,
    );
    insert_trimmed_string(
        &mut object,
        "data_collection",
        routing.data_collection.as_deref(),
    );
    insert_bool(&mut object, "zdr", routing.zdr);
    insert_bool(
        &mut object,
        "enforce_distillable_text",
        routing.enforce_distillable_text,
    );
    insert_string_array(&mut object, "order", routing.order.as_deref());
    insert_string_array(&mut object, "only", routing.only.as_deref());
    insert_string_array(&mut object, "ignore", routing.ignore.as_deref());
    insert_string_array(
        &mut object,
        "quantizations",
        routing.quantizations.as_deref(),
    );
    insert_open_router_sort(&mut object, routing);
    insert_open_router_max_price(&mut object, routing);
    insert_percentile_object(
        &mut object,
        "preferred_min_throughput",
        routing.min_throughput_p50,
        routing.min_throughput_p75,
        routing.min_throughput_p90,
        routing.min_throughput_p99,
    );
    insert_percentile_object(
        &mut object,
        "preferred_max_latency",
        routing.max_latency_p50,
        routing.max_latency_p75,
        routing.max_latency_p90,
        routing.max_latency_p99,
    );
    (!object.is_empty()).then_some(Value::Object(object))
}

fn vercel_gateway_routing_to_value(routing: &VercelGatewayRouting) -> Option<Value> {
    let mut object = Map::new();
    insert_string_array(&mut object, "only", routing.only.as_deref());
    insert_string_array(&mut object, "order", routing.order.as_deref());
    (!object.is_empty()).then_some(Value::Object(object))
}

fn insert_open_router_sort(object: &mut Map<String, Value>, routing: &OpenRouterRouting) {
    let by = routing
        .sort_by
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let partition = routing
        .sort_partition
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (by, partition) {
        (Some(by), Some(partition)) => {
            object.insert(
                "sort".to_string(),
                json!({ "by": by, "partition": partition }),
            );
        }
        (Some(by), None) => {
            object.insert("sort".to_string(), Value::String(by.to_string()));
        }
        _ => {}
    }
}

fn insert_open_router_max_price(object: &mut Map<String, Value>, routing: &OpenRouterRouting) {
    let mut value = Map::new();
    insert_f64(&mut value, "prompt", routing.max_price_prompt);
    insert_f64(&mut value, "completion", routing.max_price_completion);
    insert_f64(&mut value, "image", routing.max_price_image);
    insert_f64(&mut value, "audio", routing.max_price_audio);
    insert_f64(&mut value, "request", routing.max_price_request);
    if !value.is_empty() {
        object.insert("max_price".to_string(), Value::Object(value));
    }
}

fn insert_percentile_object(
    object: &mut Map<String, Value>,
    key: &str,
    p50: Option<f64>,
    p75: Option<f64>,
    p90: Option<f64>,
    p99: Option<f64>,
) {
    let mut value = Map::new();
    insert_f64(&mut value, "p50", p50);
    insert_f64(&mut value, "p75", p75);
    insert_f64(&mut value, "p90", p90);
    insert_f64(&mut value, "p99", p99);
    if !value.is_empty() {
        object.insert(key.to_string(), Value::Object(value));
    }
}

fn insert_headers(object: &mut Map<String, Value>, headers: Option<&[HeaderEntry]>) {
    if let Some(headers) = headers {
        if let Some(value) = headers_to_value(headers) {
            object.insert("headers".to_string(), value);
        }
    }
}

fn insert_string_array(object: &mut Map<String, Value>, key: &str, values: Option<&[String]>) {
    let Some(values) = values else {
        return;
    };
    let values = values
        .iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| Value::String(trimmed.to_string()))
        })
        .collect::<Vec<_>>();
    if !values.is_empty() {
        object.insert(key.to_string(), Value::Array(values));
    }
}

fn insert_trimmed_string(object: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            object.insert(key.to_string(), Value::String(trimmed.to_string()));
        }
    }
}

fn insert_bool(object: &mut Map<String, Value>, key: &str, value: Option<bool>) {
    if let Some(value) = value {
        object.insert(key.to_string(), Value::Bool(value));
    }
}

fn insert_f64(object: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
}

fn read_json_object(path: &Path, code: &str, file_name: &str) -> AppResult<Map<String, Value>> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let text = fs::read_to_string(path).map_err(|err| {
        AppError::new(code, format!("读取 {file_name} 失败")).with_details(err.to_string())
    })?;
    let value: Value = serde_json::from_str(&text).map_err(|err| {
        AppError::new(code, format!("{file_name} JSON 无法解析")).with_details(err.to_string())
    })?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::new(code, format!("{file_name} 根节点必须是 JSON object")))
}

fn validate_pi_json(
    provider: &Provider,
    models: &Value,
    auth: &Value,
    settings: &Value,
) -> AppResult<()> {
    if !models.get("providers").is_some_and(Value::is_object) {
        return Err(validation_error("models.json 必须包含 providers object"));
    }
    if !auth.is_object() {
        return Err(validation_error("auth.json 必须是 object"));
    }
    let settings_object = settings
        .as_object()
        .ok_or_else(|| validation_error("settings.json 必须是 object"))?;
    let default_provider = settings_object
        .get("defaultProvider")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("settings.json 缺少 defaultProvider"))?;
    let default_model = settings_object
        .get("defaultModel")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error("settings.json 缺少 defaultModel"))?;
    if default_provider != provider_id(provider) {
        return Err(validation_error("defaultProvider 与当前供应商不一致"));
    }
    let model_exists = match provider {
        Provider::Official(provider) => provider
            .models
            .iter()
            .any(|model| model.id == default_model),
        Provider::Custom(provider) => provider
            .models
            .iter()
            .any(|model| model.id == default_model),
    };
    if !model_exists {
        return Err(validation_error("defaultModel 与当前供应商模型列表不一致"));
    }
    Ok(())
}

fn write_pi_file(
    path: &Path,
    value: &Value,
    failed_file: &str,
    code: &str,
    written_files: &[String],
) -> AppResult<()> {
    atomic_write_json(path, value).map_err(|err| {
        AppError::new(code, err.message)
            .with_details(err.details.unwrap_or_default())
            .with_file(failed_file, written_files)
    })
}

fn atomic_write_json<T: Serialize>(target: &Path, value: &T) -> AppResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::new("APP_CONFIG_WRITE_FAILED", "目标文件缺少父目录"))?;
    fs::create_dir_all(parent).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "创建目标目录失败").with_details(err.to_string())
    })?;

    let json_text = serde_json::to_string_pretty(value).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "序列化 JSON 失败").with_details(err.to_string())
    })?;
    let _: Value = serde_json::from_str(&json_text).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "写入前 JSON 自检失败")
            .with_details(err.to_string())
    })?;

    let prefix = format!(
        "{}.tmp-{}-",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("config.json"),
        std::process::id()
    );
    let mut tmp = tempfile::Builder::new()
        .prefix(&prefix)
        .tempfile_in(parent)
        .map_err(|err| {
            AppError::new("APP_CONFIG_WRITE_FAILED", "创建临时文件失败")
                .with_details(err.to_string())
        })?;
    tmp.write_all(json_text.as_bytes()).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "写入临时文件失败").with_details(err.to_string())
    })?;
    tmp.write_all(b"\n").map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "写入临时文件失败").with_details(err.to_string())
    })?;
    tmp.as_file().sync_all().map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "刷新临时文件失败").with_details(err.to_string())
    })?;
    tmp.persist(target).map_err(|err| {
        AppError::new("APP_CONFIG_WRITE_FAILED", "替换目标文件失败").with_details(err.to_string())
    })?;
    Ok(())
}

async fn run_pi_ping(
    home: &Path,
    provider_id: &str,
    model_id: &str,
) -> AppResult<TestProviderResult> {
    let mut child = Command::new("pi")
        .arg("--provider")
        .arg(provider_id)
        .arg("--model")
        .arg(model_id)
        .arg("--no-session")
        .arg("-p")
        .arg("ping")
        .current_dir(home)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|err| {
            AppError::new("PI_COMMAND_NOT_FOUND", "无法启动 pi 命令").with_details(err.to_string())
        })?;

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let wait_result = timeout(Duration::from_secs(15), child.wait()).await;
    let status = match wait_result {
        Ok(result) => result.map_err(|err| {
            AppError::new("PI_TEST_FAILED", "等待 pi 命令失败").with_details(err.to_string())
        })?,
        Err(_) => {
            let _ = child.kill().await;
            let stdout = read_pipe(&mut stdout_pipe).await;
            let stderr = read_pipe(&mut stderr_pipe).await;
            return Ok(TestProviderResult {
                status: "timeout".to_string(),
                exit_code: None,
                stdout,
                stderr,
            });
        }
    };

    let stdout = read_pipe(&mut stdout_pipe).await;
    let stderr = read_pipe(&mut stderr_pipe).await;
    Ok(TestProviderResult {
        status: if status.success() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        exit_code: status.code(),
        stdout,
        stderr,
    })
}

async fn read_pipe<T>(pipe: &mut Option<T>) -> String
where
    T: AsyncReadExt + Unpin,
{
    let mut output = Vec::new();
    if let Some(pipe) = pipe {
        let _ = pipe.read_to_end(&mut output).await;
    }
    String::from_utf8_lossy(&output).to_string()
}

async fn find_pi_command_path() -> AppResult<PathBuf> {
    let output = Command::new("which")
        .arg("pi")
        .output()
        .await
        .map_err(|err| {
            AppError::new("PI_COMMAND_NOT_FOUND", "无法定位 pi 命令").with_details(err.to_string())
        })?;
    if !output.status.success() {
        return Err(
            AppError::new("PI_COMMAND_NOT_FOUND", "当前 GUI 环境无法找到 pi 命令")
                .with_details(String::from_utf8_lossy(&output.stderr).to_string()),
        );
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Err(AppError::new(
            "PI_COMMAND_NOT_FOUND",
            "当前 GUI 环境无法找到 pi 命令",
        ));
    }
    fs::canonicalize(&path).map_err(|err| {
        AppError::new("PI_COMMAND_NOT_FOUND", "无法解析 pi 命令路径")
            .with_details(format!("{path}: {err}"))
    })
}

fn parse_pi_models_json(output: &str) -> AppResult<Vec<PiModelInfo>> {
    let registry_models: Vec<PiRegistryModel> = serde_json::from_str(output).map_err(|err| {
        AppError::new("PI_MODELS_PARSE_FAILED", "Pi 模型输出无法解析").with_details(err.to_string())
    })?;
    Ok(registry_models
        .into_iter()
        .map(|model| PiModelInfo {
            provider: model.provider,
            id: model.id,
            context: format_token_count(model.context_window),
            max_out: format_token_count(model.max_tokens),
            thinking: model.reasoning,
            images: model.input.iter().any(|input| input == "image"),
        })
        .collect())
}

fn parse_pi_models_table(output: &str, provider_id: &str) -> AppResult<Vec<PiModelInfo>> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    let header = lines
        .next()
        .ok_or_else(|| AppError::new("PI_MODELS_PARSE_FAILED", "Pi 模型列表输出为空"))?;
    if !header.contains("provider")
        || !header.contains("model")
        || !header.contains("context")
        || !header.contains("max-out")
    {
        return Err(
            AppError::new("PI_MODELS_PARSE_FAILED", "Pi 模型列表表头无法识别")
                .with_details(header.to_string()),
        );
    }

    let mut models = Vec::new();
    for line in lines {
        let columns = line.split_whitespace().collect::<Vec<_>>();
        if columns.len() < 6 || columns[0] != provider_id {
            continue;
        }
        models.push(PiModelInfo {
            provider: columns[0].to_string(),
            id: columns[1].to_string(),
            context: columns[2].to_string(),
            max_out: columns[3].to_string(),
            thinking: parse_yes_no(columns[4])?,
            images: parse_yes_no(columns[5])?,
        });
    }
    Ok(models)
}

fn parse_yes_no(value: &str) -> AppResult<bool> {
    match value {
        "yes" => Ok(true),
        "no" => Ok(false),
        _ => Err(AppError::new(
            "PI_MODELS_PARSE_FAILED",
            format!("无法解析布尔列: {value}"),
        )),
    }
}

fn format_token_count(count: u64) -> String {
    if count >= 1_000_000 {
        let millions = count as f64 / 1_000_000.0;
        if count % 1_000_000 == 0 {
            format!("{}M", count / 1_000_000)
        } else {
            format!("{millions:.1}M")
        }
    } else if count >= 1_000 {
        let thousands = count as f64 / 1_000.0;
        if count % 1_000 == 0 {
            format!("{}K", count / 1_000)
        } else {
            format!("{thousands:.1}K")
        }
    } else {
        count.to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_webview_environment();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(OAuthLoginSessions::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Pi Switch");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_config,
            save_app_config,
            apply_provider_to_pi,
            test_provider,
            fetch_custom_provider_models,
            list_pi_models,
            load_auth_accounts,
            create_api_key_account,
            rename_auth_account,
            delete_auth_account,
            duplicate_auth_account,
            apply_auth_account,
            import_pi_auth_account,
            submit_oauth_manual_code,
            login_official_provider_oauth
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    fn official_provider() -> Provider {
        Provider::Official(OfficialProvider {
            id: "provider_official".to_string(),
            name: "OpenAI Daily".to_string(),
            provider_id: "openai".to_string(),
            auth_mode: AuthMode::ApiKey,
            auth_account_id: None,
            api_key: "  sk-test  ".to_string(),
            advanced: None,
            models: vec![ModelConfig {
                id: "gpt-5.5".to_string(),
                name: None,
                source: Some(ModelSource::Builtin),
                override_built_in: None,
                api: None,
                reasoning: None,
                input: None,
                context_window: None,
                max_tokens: None,
                cost: None,
                headers: None,
                compat: None,
                thinking_level_map: None,
            }],
            default_model_id: "gpt-5.5".to_string(),
        })
    }

    fn custom_provider() -> Provider {
        Provider::Custom(CustomProvider {
            id: "provider_custom".to_string(),
            name: "Relay".to_string(),
            base_url: " https://relay.example.com/v1 ".to_string(),
            api: "openai-completions".to_string(),
            api_key: " relay-key ".to_string(),
            headers: None,
            auth_header: None,
            compat: None,
            models: vec![ModelConfig {
                id: "deepseek chat".to_string(),
                name: Some("DeepSeek Chat".to_string()),
                source: Some(ModelSource::Custom),
                override_built_in: None,
                api: None,
                reasoning: Some(true),
                input: Some(vec!["text".to_string(), "image".to_string()]),
                context_window: Some(128000),
                max_tokens: Some(32000),
                cost: Some(CostConfig {
                    input: Some(0.1),
                    output: Some(0.2),
                    cache_read: Some(0.01),
                    cache_write: Some(0.02),
                }),
                headers: Some(vec![HeaderEntry {
                    key: "x-model-key".to_string(),
                    value: "$MODEL_KEY".to_string(),
                }]),
                compat: Some(CompatConfig {
                    supports_developer_role: Some(false),
                    supports_reasoning_effort: Some(false),
                    ..Default::default()
                }),
                thinking_level_map: Some(HashMap::from([
                    ("minimal".to_string(), None),
                    ("high".to_string(), Some("high".to_string())),
                ])),
            }],
            default_model_id: "deepseek chat".to_string(),
        })
    }

    fn incomplete_custom_provider() -> Provider {
        Provider::Custom(CustomProvider {
            id: "provider_incomplete".to_string(),
            name: "Incomplete".to_string(),
            base_url: "".to_string(),
            api: "".to_string(),
            api_key: "".to_string(),
            headers: None,
            auth_header: None,
            compat: None,
            models: Vec::new(),
            default_model_id: "".to_string(),
        })
    }

    fn official_provider_with_custom_and_override() -> Provider {
        Provider::Official(OfficialProvider {
            id: "provider_official".to_string(),
            name: "OpenAI Daily".to_string(),
            provider_id: "openai".to_string(),
            auth_mode: AuthMode::Existing,
            auth_account_id: None,
            api_key: "".to_string(),
            advanced: Some(ProviderAdvancedConfig {
                base_url: Some(" https://proxy.example.com/v1 ".to_string()),
                api: None,
                api_key: Some("$PROXY_KEY".to_string()),
                headers: Some(vec![HeaderEntry {
                    key: "x-proxy".to_string(),
                    value: "$PROXY_KEY".to_string(),
                }]),
                auth_header: Some(true),
                compat: None,
            }),
            models: vec![
                ModelConfig {
                    id: "gpt-new".to_string(),
                    name: Some("GPT New".to_string()),
                    source: Some(ModelSource::Custom),
                    override_built_in: None,
                    api: Some("openai-responses".to_string()),
                    reasoning: Some(true),
                    input: Some(vec!["text".to_string()]),
                    context_window: Some(272000),
                    max_tokens: Some(128000),
                    cost: None,
                    headers: None,
                    compat: None,
                    thinking_level_map: None,
                },
                ModelConfig {
                    id: "gpt-5.5".to_string(),
                    name: Some("GPT 5.5 Proxy".to_string()),
                    source: Some(ModelSource::Builtin),
                    override_built_in: Some(true),
                    api: None,
                    reasoning: Some(true),
                    input: None,
                    context_window: Some(400000),
                    max_tokens: Some(128000),
                    cost: None,
                    headers: None,
                    compat: Some(CompatConfig {
                        send_session_id_header: Some(false),
                        ..Default::default()
                    }),
                    thinking_level_map: None,
                },
            ],
            default_model_id: "gpt-5.5".to_string(),
        })
    }

    #[test]
    fn official_auth_upsert_preserves_oauth_and_unknown_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{
              "openai": { "type": "oauth", "accessToken": "keep-if-overwritten-by-current-official" },
              "anthropic": { "type": "oauth", "accessToken": "keep" },
              "unknown": { "shape": true }
            }"#,
        )
        .unwrap();

        let value = build_auth_json(&official_provider(), &path, None).unwrap();
        assert_eq!(
            value["openai"],
            json!({ "type": "api_key", "key": "sk-test" })
        );
        assert_eq!(value["anthropic"]["type"], "oauth");
        assert_eq!(value["unknown"]["shape"], true);
    }

    #[test]
    fn custom_provider_does_not_write_auth_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai": { "type": "oauth", "accessToken": "keep" } }"#,
        )
        .unwrap();

        let value = build_auth_json(&custom_provider(), &path, None).unwrap();
        assert_eq!(value["openai"]["type"], "oauth");
        assert!(value.get("Relay").is_none());
    }

    #[test]
    fn official_existing_auth_does_not_overwrite_auth_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai": { "type": "oauth", "accessToken": "keep" } }"#,
        )
        .unwrap();

        let value =
            build_auth_json(&official_provider_with_custom_and_override(), &path, None).unwrap();
        assert_eq!(value["openai"]["type"], "oauth");
        assert_eq!(value["openai"]["accessToken"], "keep");
    }

    fn test_account(id: &str, provider_id: &str, token: &str) -> AuthAccount {
        AuthAccount {
            id: id.to_string(),
            provider_id: provider_id.to_string(),
            label: id.to_string(),
            kind: AuthAccountKind::OAuth,
            base_url: None,
            credential: json!({
                "type": "oauth",
                "accessToken": token
            }),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            last_applied_at: None,
            active_in_pi: false,
        }
    }

    fn test_jwt_token(payload: Value) -> String {
        format!(
            "header.{}.signature",
            URL_SAFE_NO_PAD.encode(payload.to_string())
        )
    }

    #[test]
    fn generated_account_ids_are_unique_under_burst_creation() {
        let mut ids = HashSet::new();
        for _ in 0..1000 {
            let id = create_account_id();
            assert!(id.starts_with("account_"));
            assert!(ids.insert(id));
        }
    }

    #[test]
    fn duplicate_account_copies_credential_with_new_identity() {
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.label = "Codex Work".to_string();
        account.last_applied_at = Some("100".to_string());
        account.active_in_pi = true;
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account],
        };

        let duplicate = duplicate_auth_account_in_store(&mut store, "codex_a").unwrap();

        assert_ne!(duplicate.id, "codex_a");
        assert_eq!(duplicate.label, "Codex Work Copy");
        assert_eq!(duplicate.credential["accessToken"], "token-a");
        assert!(duplicate.last_applied_at.is_none());
        assert!(!duplicate.active_in_pi);
        assert_eq!(store.accounts.len(), 2);
    }

    #[test]
    fn default_account_labels_are_unique_for_same_provider_accounts() {
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![],
        };
        let label = normalize_account_label(None, "openai-codex", AuthAccountKind::OAuth);

        let first = upsert_auth_account(
            &mut store,
            "openai-codex".to_string(),
            label.clone(),
            AuthAccountKind::OAuth,
            None,
            json!({ "type": "oauth", "accessToken": "token-a" }),
        )
        .unwrap();
        let second = upsert_auth_account(
            &mut store,
            "openai-codex".to_string(),
            label.clone(),
            AuthAccountKind::OAuth,
            None,
            json!({ "type": "oauth", "accessToken": "token-b" }),
        )
        .unwrap();
        let third = upsert_auth_account(
            &mut store,
            "openai-codex".to_string(),
            label,
            AuthAccountKind::OAuth,
            None,
            json!({ "type": "oauth", "accessToken": "token-c" }),
        )
        .unwrap();

        assert_eq!(first.label, "openai-codex OAuth");
        assert_eq!(second.label, "openai-codex OAuth 2");
        assert_eq!(third.label, "openai-codex OAuth 3");
    }

    #[test]
    fn oauth_default_label_prefers_safe_identity() {
        let credential = json!({
            "type": "oauth",
            "user": {
                "email": "codex@example.test"
            },
            "accessToken": "token-a"
        });

        let label = normalize_account_label_for_credential(
            None,
            "openai-codex",
            AuthAccountKind::OAuth,
            &credential,
        );

        assert_eq!(label, "codex@example.test");
    }

    #[test]
    fn oauth_default_label_falls_back_without_identity() {
        let credential = json!({
            "type": "oauth",
            "accessToken": "token-a"
        });

        let label = normalize_account_label_for_credential(
            None,
            "openai-codex",
            AuthAccountKind::OAuth,
            &credential,
        );

        assert_eq!(label, "openai-codex OAuth");
    }

    #[test]
    fn duplicate_credentials_reuse_existing_account() {
        let mut existing = test_account("codex_a", "openai-codex", "token-a");
        existing.label = "Codex A".to_string();
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![existing],
        };

        let account = upsert_auth_account(
            &mut store,
            "openai-codex".to_string(),
            "openai-codex OAuth".to_string(),
            AuthAccountKind::OAuth,
            None,
            json!({ "type": "oauth", "accessToken": "token-a" }),
        )
        .unwrap();

        assert_eq!(account.id, "codex_a");
        assert_eq!(account.label, "Codex A");
        assert_eq!(store.accounts.len(), 1);
    }

    #[test]
    fn duplicate_oauth_identity_updates_existing_account() {
        let token_a = test_jwt_token(json!({
            "email": "codex@example.test",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "chatgpt-account-1"
            }
        }));
        let token_b = test_jwt_token(json!({
            "email": "codex@example.test",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "chatgpt-account-1"
            }
        }));
        let mut existing = test_account("codex_a", "openai-codex", "token-a");
        existing.label = "Codex A".to_string();
        existing.credential = json!({
            "type": "oauth",
            "tokens": {
                "id_token": token_a
            },
            "refreshToken": "refresh-a"
        });
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![existing],
        };

        let account = upsert_auth_account(
            &mut store,
            "openai-codex".to_string(),
            "openai-codex OAuth".to_string(),
            AuthAccountKind::OAuth,
            None,
            json!({
                "type": "oauth",
                "tokens": {
                    "id_token": token_b
                },
                "refreshToken": "refresh-b"
            }),
        )
        .unwrap();

        assert_eq!(account.id, "codex_a");
        assert_eq!(account.label, "Codex A");
        assert_eq!(account.credential["refreshToken"], "refresh-b");
        assert_eq!(store.accounts.len(), 1);
    }

    #[test]
    fn duplicate_account_labels_are_unique() {
        let mut first = test_account("codex_a", "openai-codex", "token-a");
        first.label = "Codex Work".to_string();
        let mut existing_copy = test_account("codex_b", "openai-codex", "token-b");
        existing_copy.label = "Codex Work Copy".to_string();
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![first, existing_copy],
        };

        let duplicate = duplicate_auth_account_in_store(&mut store, "codex_a").unwrap();

        assert_eq!(duplicate.label, "Codex Work Copy 2");
    }

    #[test]
    fn account_view_does_not_serialize_credential() {
        let account = test_account("codex_a", "openai-codex", "token-a");
        let value = serde_json::to_value(account_to_view(&account)).unwrap();

        assert!(value.get("credential").is_none());
        assert_eq!(value["id"], "codex_a");
        assert_eq!(value["providerId"], "openai-codex");
        assert_eq!(value["kind"], "oauth");
    }

    #[test]
    fn account_view_serializes_safe_identity_without_secret_values() {
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.credential = json!({
            "type": "oauth",
            "accessToken": "token-a",
            "user": {
                "email": "codex@example.test",
                "id": "user-1",
                "refreshToken": "refresh-token"
            },
            "account": {
                "id": "account-1"
            }
        });

        let value = serde_json::to_value(account_to_view(&account)).unwrap();

        assert!(value.get("credential").is_none());
        let identity = value["identity"].as_array().unwrap();
        assert!(identity.contains(&json!({ "field": "user.email", "value": "codex@example.test" })));
        assert!(identity.contains(&json!({ "field": "user.id", "value": "user-1" })));
        assert!(identity.contains(&json!({ "field": "account.id", "value": "account-1" })));
        assert!(!value.to_string().contains("token-a"));
        assert!(!value.to_string().contains("refresh-token"));
    }

    #[test]
    fn account_view_extracts_safe_identity_from_jwt_tokens() {
        let payload = json!({
            "email": "codex@example.test",
            "sub": "user-subject",
            "auth_provider": "openai",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "chatgpt-account-1",
                "chatgpt_user_id": "chatgpt-user-1"
            }
        });
        let token = test_jwt_token(payload);
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.credential = json!({
            "type": "oauth",
            "tokens": {
                "id_token": token
            }
        });

        let value = serde_json::to_value(account_to_view(&account)).unwrap();

        let identity = value["identity"].as_array().unwrap();
        assert!(
            identity.contains(&json!({ "field": "oauth.email", "value": "codex@example.test" }))
        );
        assert!(identity.contains(&json!({ "field": "oauth.sub", "value": "user-subject" })));
        assert!(identity
            .contains(&json!({ "field": "oauth.chatgptAccountId", "value": "chatgpt-account-1" })));
        assert!(identity
            .contains(&json!({ "field": "oauth.chatgptUserId", "value": "chatgpt-user-1" })));
        assert!(!value.to_string().contains("header."));
        assert!(!value.to_string().contains("signature"));
    }

    #[test]
    fn account_view_serializes_api_key_kind_for_frontend_contract() {
        let account = AuthAccount {
            id: "openai_key".to_string(),
            provider_id: "openai".to_string(),
            label: "OpenAI Key".to_string(),
            kind: AuthAccountKind::ApiKey,
            base_url: Some("https://api.openai.com/v1".to_string()),
            credential: create_api_key_credential("sk-account"),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            last_applied_at: None,
            active_in_pi: false,
        };
        let value = serde_json::to_value(account_to_view(&account)).unwrap();

        assert_eq!(value["kind"], "apiKey");
        assert_eq!(value["baseUrl"], "https://api.openai.com/v1");
        assert!(value.get("credential").is_none());
    }

    #[test]
    fn accounts_store_loads_missing_version_and_accounts_as_v1_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.json");
        fs::write(&path, r#"{}"#).unwrap();

        let store = load_accounts_store_from_path(&path).unwrap();

        assert_eq!(store.version, ACCOUNTS_VERSION);
        assert!(store.accounts.is_empty());
    }

    #[test]
    fn accounts_store_save_creates_parent_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("accounts.json");
        let store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![test_account("codex_a", "openai-codex", "token-a")],
        };

        save_accounts_store_to_path(&path, &store).unwrap();

        let loaded = load_accounts_store_from_path(&path).unwrap();
        assert_eq!(loaded.accounts.len(), 1);
        assert_eq!(loaded.accounts[0].id, "codex_a");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn accounts_store_save_does_not_persist_active_in_pi_view_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.json");
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.active_in_pi = true;
        let store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account],
        };

        save_accounts_store_to_path(&path, &store).unwrap();

        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(raw["accounts"][0].get("activeInPi").is_none());
        let loaded = load_accounts_store_from_path(&path).unwrap();
        assert!(!loaded.accounts[0].active_in_pi);
    }

    #[test]
    fn accounts_store_rejects_unsupported_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.json");
        fs::write(&path, r#"{ "version": 999, "accounts": [] }"#).unwrap();

        let err = load_accounts_store_from_path(&path).unwrap_err();

        assert_eq!(err.code, "UNSUPPORTED_ACCOUNTS_VERSION");
        assert!(err.message.contains("999"));
    }

    #[test]
    fn accounts_store_loads_legacy_oauth_kind_spelling() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("accounts.json");
        fs::write(
            &path,
            r#"{
              "version": 1,
              "accounts": [{
                "id": "codex_a",
                "providerId": "openai-codex",
                "label": "Codex A",
                "kind": "oAuth",
                "credential": { "type": "oauth", "accessToken": "token-a" },
                "createdAt": "1",
                "updatedAt": "1"
              }]
            }"#,
        )
        .unwrap();

        let store = load_accounts_store_from_path(&path).unwrap();
        let value = serde_json::to_value(account_to_view(&store.accounts[0])).unwrap();

        assert_eq!(store.accounts[0].kind, AuthAccountKind::OAuth);
        assert_eq!(value["kind"], "oauth");
    }

    fn official_provider_using_account(account_id: &str) -> Provider {
        let mut provider = match official_provider_with_custom_and_override() {
            Provider::Official(provider) => provider,
            Provider::Custom(_) => unreachable!(),
        };
        provider.provider_id = "openai-codex".to_string();
        provider.auth_mode = AuthMode::Account;
        provider.auth_account_id = Some(account_id.to_string());
        Provider::Official(provider)
    }

    #[test]
    fn clear_deleted_account_bindings_resets_official_providers() {
        let mut bound = match official_provider_using_account("codex_a") {
            Provider::Official(provider) => provider,
            Provider::Custom(_) => unreachable!(),
        };
        bound.id = "provider_bound".to_string();
        let mut other = match official_provider_using_account("codex_b") {
            Provider::Official(provider) => provider,
            Provider::Custom(_) => unreachable!(),
        };
        other.id = "provider_other".to_string();
        let mut config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some("provider_bound".to_string()),
            providers: vec![
                Provider::Official(bound),
                Provider::Official(other),
                custom_provider(),
            ],
        };

        let changed = clear_deleted_account_bindings(&mut config, "codex_a");

        assert!(changed);
        let Provider::Official(bound) = &config.providers[0] else {
            unreachable!();
        };
        assert!(matches!(bound.auth_mode, AuthMode::Existing));
        assert!(bound.auth_account_id.is_none());
        let Provider::Official(other) = &config.providers[1] else {
            unreachable!();
        };
        assert!(matches!(other.auth_mode, AuthMode::Account));
        assert_eq!(other.auth_account_id.as_deref(), Some("codex_b"));
    }

    #[test]
    fn clear_deleted_account_bindings_in_config_file_updates_saved_config() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some("provider_official".to_string()),
            providers: vec![official_provider_using_account("codex_a")],
        };
        atomic_write_json(&path, &config).unwrap();

        clear_deleted_account_bindings_in_config_file(&path, "codex_a").unwrap();

        let saved: AppConfig = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let Provider::Official(provider) = &saved.providers[0] else {
            unreachable!();
        };
        assert!(matches!(provider.auth_mode, AuthMode::Existing));
        assert!(provider.auth_account_id.is_none());
        clear_deleted_account_bindings_in_config_file(&dir.path().join("missing.json"), "codex_a")
            .unwrap();
    }

    #[test]
    fn multiple_same_provider_accounts_can_switch_pi_auth() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let account_a = test_account("codex_a", "openai-codex", "token-a");
        let account_b = test_account("codex_b", "openai-codex", "token-b");

        write_account_to_pi_auth(&account_a, &path).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["openai-codex"]["accessToken"], "token-a");

        write_account_to_pi_auth(&account_b, &path).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["openai-codex"]["accessToken"], "token-b");
    }

    #[test]
    fn official_account_auth_mode_writes_selected_account_credential() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "anthropic": { "type": "oauth", "accessToken": "keep" } }"#,
        )
        .unwrap();
        let store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![
                test_account("codex_a", "openai-codex", "token-a"),
                test_account("codex_b", "openai-codex", "token-b"),
            ],
        };

        let value = build_auth_json(
            &official_provider_using_account("codex_b"),
            &path,
            Some(&store),
        )
        .unwrap();

        assert_eq!(value["openai-codex"]["accessToken"], "token-b");
        assert_eq!(value["anthropic"]["accessToken"], "keep");
    }

    #[test]
    fn api_key_accounts_can_be_applied_to_pi_auth() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let account = AuthAccount {
            id: "openai_key".to_string(),
            provider_id: "openai".to_string(),
            label: "OpenAI Key".to_string(),
            kind: AuthAccountKind::ApiKey,
            base_url: Some("https://api.openai.com/v1".to_string()),
            credential: create_api_key_credential("sk-account"),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            last_applied_at: None,
            active_in_pi: false,
        };

        write_account_to_pi_auth(&account, &path).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value["openai"],
            json!({ "type": "api_key", "key": "sk-account" })
        );
    }

    #[test]
    fn api_key_accounts_are_not_fuzzy_synced_from_external_pi_auth() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai": { "type": "api_key", "key": "sk-external" } }"#,
        )
        .unwrap();
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![AuthAccount {
                id: "openai_key".to_string(),
                provider_id: "openai".to_string(),
                label: "OpenAI Key".to_string(),
                kind: AuthAccountKind::ApiKey,
                base_url: Some("https://api.openai.com/v1".to_string()),
                credential: create_api_key_credential("sk-saved"),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                last_applied_at: Some("100".to_string()),
                active_in_pi: false,
            }],
        };

        let changed = annotate_active_accounts(&mut store, &path);

        assert!(!changed);
        assert!(!store.accounts[0].active_in_pi);
        assert_eq!(store.accounts[0].credential["key"], "sk-saved");
    }

    #[test]
    fn account_models_json_overlay_preserves_existing_models_and_overrides_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        fs::write(
            &path,
            r#"{
              "providers": {
                "openai": {
                  "baseUrl": "https://old.example.com/v1",
                  "models": [{ "id": "gpt-5.5" }]
                },
                "Relay": {
                  "baseUrl": "https://relay.example.com/v1",
                  "apiKey": "relay-key"
                }
              }
            }"#,
        )
        .unwrap();
        let account = AuthAccount {
            id: "openai_key".to_string(),
            provider_id: "openai".to_string(),
            label: "OpenAI Key".to_string(),
            kind: AuthAccountKind::ApiKey,
            base_url: Some(" https://proxy.example.com/v1 ".to_string()),
            credential: create_api_key_credential("sk-account"),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            last_applied_at: None,
            active_in_pi: false,
        };

        let value = build_account_models_json(&account, &path).unwrap().unwrap();

        assert_eq!(
            value["providers"]["openai"]["baseUrl"],
            "https://proxy.example.com/v1"
        );
        assert_eq!(value["providers"]["openai"]["models"][0]["id"], "gpt-5.5");
        assert!(value["providers"]["openai"].get("apiKey").is_none());
        assert_eq!(value["providers"]["Relay"]["apiKey"], "relay-key");
    }

    #[test]
    fn applying_custom_api_key_account_writes_models_without_touching_settings_or_auth() {
        let dir = tempfile::tempdir().unwrap();
        let app_config_dir = dir.path().join("PiSwitch");
        let pi_agent_dir = dir.path().join(".pi").join("agent");
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::create_dir_all(&pi_agent_dir).unwrap();
        fs::write(
            pi_agent_dir.join("auth.json"),
            r#"{ "openai": { "type": "oauth", "accessToken": "keep" } }"#,
        )
        .unwrap();
        fs::write(
            pi_agent_dir.join("settings.json"),
            r#"{ "defaultProvider": "openai", "defaultModel": "gpt-5.5", "enabledModels": ["gpt-5.5"] }"#,
        )
        .unwrap();
        fs::write(
            pi_agent_dir.join("models.json"),
            r#"{ "providers": { "Relay": { "models": [{ "id": "deepseek-chat" }] } } }"#,
        )
        .unwrap();
        let account = AuthAccount {
            id: "relay_key".to_string(),
            provider_id: "Relay".to_string(),
            label: "Relay Key".to_string(),
            kind: AuthAccountKind::ApiKey,
            base_url: Some("https://relay.example.com/v1".to_string()),
            credential: create_api_key_credential("relay-key"),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            last_applied_at: None,
            active_in_pi: false,
        };
        save_accounts_store_to_path(
            &app_config_dir.join("accounts.json"),
            &AccountsStore {
                version: ACCOUNTS_VERSION,
                accounts: vec![account],
            },
        )
        .unwrap();
        let paths = Paths {
            app_config_dir: app_config_dir.clone(),
            app_config_file: app_config_dir.join("config.json"),
            accounts_file: app_config_dir.join("accounts.json"),
            pi_agent_dir: pi_agent_dir.clone(),
            pi_models_file: pi_agent_dir.join("models.json"),
            pi_auth_file: pi_agent_dir.join("auth.json"),
            pi_settings_file: pi_agent_dir.join("settings.json"),
            home: dir.path().to_path_buf(),
        };

        let applied = apply_account_to_pi(
            ApplyAuthAccountInput {
                account_id: "relay_key".to_string(),
            },
            &paths,
        )
        .unwrap();

        assert_eq!(applied.id, "relay_key");
        assert!(applied.active_in_pi);
        let models: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_models_file).unwrap()).unwrap();
        let auth: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_auth_file).unwrap()).unwrap();
        let settings: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_settings_file).unwrap()).unwrap();
        assert_eq!(
            models["providers"]["Relay"]["baseUrl"],
            "https://relay.example.com/v1"
        );
        assert_eq!(models["providers"]["Relay"]["apiKey"], "relay-key");
        assert_eq!(
            models["providers"]["Relay"]["models"][0]["id"],
            "deepseek-chat"
        );
        assert_eq!(auth["openai"]["accessToken"], "keep");
        assert!(auth.get("Relay").is_none());
        assert_eq!(settings["defaultProvider"], "openai");
        assert_eq!(settings["defaultModel"], "gpt-5.5");
    }

    #[test]
    fn active_account_status_is_derived_from_current_pi_auth() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-b" } }"#,
        )
        .unwrap();
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![
                test_account("codex_a", "openai-codex", "token-a"),
                test_account("codex_b", "openai-codex", "token-b"),
            ],
        };

        let _ = annotate_active_accounts(&mut store, &path);

        assert!(!store.accounts[0].active_in_pi);
        assert!(store.accounts[1].active_in_pi);
    }

    #[test]
    fn active_account_status_prefers_oauth_identity_over_latest_applied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let token_a_refreshed = test_jwt_token(json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "chatgpt-account-a"
            }
        }));
        fs::write(
            &path,
            serde_json::to_string(&json!({
                "openai-codex": {
                    "type": "oauth",
                    "tokens": {
                        "id_token": token_a_refreshed
                    },
                    "refreshToken": "refresh-a-new"
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let mut account_a = test_account("codex_a", "openai-codex", "token-a");
        account_a.last_applied_at = Some("100".to_string());
        account_a.credential = json!({
            "type": "oauth",
            "tokens": {
                "id_token": test_jwt_token(json!({
                    "https://api.openai.com/auth": {
                        "chatgpt_account_id": "chatgpt-account-a"
                    }
                }))
            },
            "refreshToken": "refresh-a-old"
        });
        let mut account_b = test_account("codex_b", "openai-codex", "token-b");
        account_b.last_applied_at = Some("200".to_string());
        account_b.credential = json!({
            "type": "oauth",
            "tokens": {
                "id_token": test_jwt_token(json!({
                    "https://api.openai.com/auth": {
                        "chatgpt_account_id": "chatgpt-account-b"
                    }
                }))
            },
            "refreshToken": "refresh-b"
        });
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account_a, account_b],
        };

        let changed = annotate_active_accounts(&mut store, &path);

        assert!(changed);
        assert!(store.accounts[0].active_in_pi);
        assert!(!store.accounts[1].active_in_pi);
        assert_eq!(
            store.accounts[0].credential["refreshToken"],
            "refresh-a-new"
        );
        assert_eq!(store.accounts[1].credential["refreshToken"], "refresh-b");
    }

    #[test]
    fn active_status_syncs_refreshed_pi_auth_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-a-refreshed" } }"#,
        )
        .unwrap();
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.last_applied_at = Some("100".to_string());
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account],
        };

        let changed = annotate_active_accounts(&mut store, &path);

        assert!(changed);
        assert!(store.accounts[0].active_in_pi);
        assert_eq!(
            store.accounts[0].credential["accessToken"],
            "token-a-refreshed"
        );
    }

    #[test]
    fn syncs_refreshed_current_pi_oauth_back_before_switching_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-a-refreshed" } }"#,
        )
        .unwrap();
        let mut account_a = test_account("codex_a", "openai-codex", "token-a");
        account_a.last_applied_at = Some("100".to_string());
        let account_b = test_account("codex_b", "openai-codex", "token-b");
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account_a, account_b],
        };

        sync_current_pi_auth_to_matching_account(
            &mut store,
            &path,
            "openai-codex",
            Some("codex_b"),
        )
        .unwrap();
        write_account_to_pi_auth(&store.accounts[1], &path).unwrap();

        assert_eq!(
            store.accounts[0].credential["accessToken"],
            "token-a-refreshed"
        );
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["openai-codex"]["accessToken"], "token-b");
    }

    #[test]
    fn sync_before_switch_excludes_target_account() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-current" } }"#,
        )
        .unwrap();
        let mut target = test_account("codex_target", "openai-codex", "token-target");
        target.last_applied_at = Some("100".to_string());
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![target],
        };

        sync_current_pi_auth_to_matching_account(
            &mut store,
            &path,
            "openai-codex",
            Some("codex_target"),
        )
        .unwrap();

        assert_eq!(store.accounts[0].credential["accessToken"], "token-target");
    }

    #[test]
    fn reapplying_current_account_syncs_refreshed_credential_to_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(
            &path,
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-a-refreshed" } }"#,
        )
        .unwrap();
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.last_applied_at = Some("100".to_string());
        let mut store = AccountsStore {
            version: ACCOUNTS_VERSION,
            accounts: vec![account],
        };

        let target_is_current = account_matches_current_pi_auth(&store, "codex_a", &path).unwrap();
        sync_current_pi_auth_to_matching_account(
            &mut store,
            &path,
            "openai-codex",
            (!target_is_current).then_some("codex_a"),
        )
        .unwrap();
        write_account_to_pi_auth(&store.accounts[0], &path).unwrap();

        assert!(target_is_current);
        assert_eq!(
            store.accounts[0].credential["accessToken"],
            "token-a-refreshed"
        );
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["openai-codex"]["accessToken"], "token-a-refreshed");
    }

    #[test]
    fn settings_preserves_other_fields_and_upserts_enabled_models() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{ "theme": "dark", "defaultProvider": "old", "defaultModel": "old-model", "enabledModels": ["old"] }"#,
        )
        .unwrap();

        let value = build_settings_json(&custom_provider(), &path).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["defaultProvider"], "Relay");
        assert_eq!(value["defaultModel"], "deepseek chat");
        assert_eq!(value["enabledModels"], json!(["deepseek chat"]));
    }

    #[test]
    fn custom_models_json_writes_full_model_shape_and_omits_provider_name() {
        let value = build_models_json(&custom_provider());
        let provider = &value["providers"]["Relay"];
        assert!(provider.get("name").is_none());
        assert_eq!(provider["baseUrl"], "https://relay.example.com/v1");
        assert_eq!(provider["apiKey"], "relay-key");
        assert_eq!(provider["models"][0]["id"], "deepseek chat");
        assert_eq!(provider["models"][0]["name"], "DeepSeek Chat");
        assert_eq!(provider["models"][0]["reasoning"], true);
        assert_eq!(provider["models"][0]["input"], json!(["text", "image"]));
        assert_eq!(provider["models"][0]["contextWindow"], 128000);
        assert_eq!(provider["models"][0]["maxTokens"], 32000);
        assert_eq!(provider["models"][0]["cost"]["cacheRead"], 0.01);
        assert_eq!(
            provider["models"][0]["headers"]["x-model-key"],
            "$MODEL_KEY"
        );
        assert_eq!(
            provider["models"][0]["compat"]["supportsDeveloperRole"],
            false
        );
        assert_eq!(
            provider["models"][0]["thinkingLevelMap"]["minimal"],
            Value::Null
        );
    }

    #[test]
    fn official_models_json_is_empty_without_custom_models_or_overrides() {
        let value = build_models_json(&official_provider());
        assert_eq!(value, json!({ "providers": {} }));
    }

    #[test]
    fn official_models_json_writes_custom_models_and_model_overrides() {
        let value = build_models_json(&official_provider_with_custom_and_override());
        let provider = &value["providers"]["openai"];
        assert_eq!(provider["baseUrl"], "https://proxy.example.com/v1");
        assert_eq!(provider["apiKey"], "$PROXY_KEY");
        assert_eq!(provider["headers"]["x-proxy"], "$PROXY_KEY");
        assert_eq!(provider["authHeader"], true);
        assert_eq!(provider["models"][0]["id"], "gpt-new");
        assert_eq!(provider["models"][0]["api"], "openai-responses");
        assert_eq!(
            provider["modelOverrides"]["gpt-5.5"]["name"],
            "GPT 5.5 Proxy"
        );
        assert_eq!(
            provider["modelOverrides"]["gpt-5.5"]["compat"]["sendSessionIdHeader"],
            false
        );
    }

    #[test]
    fn open_router_routing_accepts_camel_case_ipc_and_writes_snake_case_pi_config() {
        let routing: OpenRouterRouting = serde_json::from_value(json!({
            "allowFallbacks": true,
            "requireParameters": false,
            "dataCollection": "deny",
            "zdr": true,
            "enforceDistillableText": true,
            "sortBy": "price"
        }))
        .unwrap();

        let value = open_router_routing_to_value(&routing).unwrap();
        assert_eq!(value["allow_fallbacks"], true);
        assert_eq!(value["require_parameters"], false);
        assert_eq!(value["data_collection"], "deny");
        assert_eq!(value["zdr"], true);
        assert_eq!(value["enforce_distillable_text"], true);
        assert_eq!(value["sort"], "price");
    }

    #[test]
    fn app_config_ipc_routing_reaches_pi_models_json() {
        let config: AppConfig = serde_json::from_value(json!({
            "schemaVersion": SCHEMA_VERSION,
            "theme": "system",
            "activeProviderId": "provider_custom",
            "providers": [{
                "kind": "custom",
                "id": "provider_custom",
                "name": "Relay",
                "baseUrl": "https://relay.example.com/v1",
                "api": "openai-completions",
                "apiKey": "relay-key",
                "compat": {
                    "openRouterRouting": {
                        "allowFallbacks": true,
                        "requireParameters": false,
                        "dataCollection": "deny",
                        "enforceDistillableText": true
                    }
                },
                "models": [{ "id": "gpt-5.5", "source": "custom" }],
                "defaultModelId": "gpt-5.5"
            }]
        }))
        .unwrap();

        let models = build_models_json(&config.providers[0]);
        let routing = &models["providers"]["Relay"]["compat"]["openRouterRouting"];
        assert_eq!(routing["allow_fallbacks"], true);
        assert_eq!(routing["require_parameters"], false);
        assert_eq!(routing["data_collection"], "deny");
        assert_eq!(routing["enforce_distillable_text"], true);
    }

    #[test]
    fn oauth_login_script_defaults_openai_codex_to_browser_login() {
        let script = oauth_login_script(
            Path::new("/tmp/pi package/dist/index.js"),
            "openai-codex",
            Path::new("/tmp/oauth auth/auth.json"),
            "oauth_test",
            Path::new("/tmp/oauth auth/manual-code.txt"),
        );
        assert!(script.contains("\"file:///tmp/pi package/dist/index.js\""));
        assert!(script.contains("\"/tmp/oauth auth/auth.json\""));
        assert!(script.contains("\"/tmp/oauth auth/manual-code.txt\""));
        assert!(script.contains("const providerId = \"openai-codex\";"));
        assert!(script.contains("const loginId = \"oauth_test\";"));
        assert!(script.contains("providerId === \"openai-codex\" ? \"browser\""));
        assert!(script.contains("type: \"manualCode\""));
        assert!(script.contains("onManualCodeInput: waitForManualCode"));
        assert!(!script.contains("oauth-login"));
    }

    #[test]
    fn oauth_event_serializes_login_id_for_frontend_manual_code() {
        let event = OAuthEvent {
            event_type: "manualCode".to_string(),
            login_id: Some("oauth_test".to_string()),
            provider_id: "openai-codex".to_string(),
            provider_name: Some("ChatGPT Plus/Pro (Codex Subscription)".to_string()),
            message: Some("Paste code".to_string()),
            url: None,
            instructions: None,
            verification_uri: None,
            user_code: None,
            interval_seconds: None,
            expires_in_seconds: None,
            selected: None,
        };

        let value = serde_json::to_value(event).unwrap();

        assert_eq!(value["type"], "manualCode");
        assert_eq!(value["loginId"], "oauth_test");
        assert_eq!(value["providerId"], "openai-codex");
    }

    #[test]
    fn submit_oauth_manual_code_writes_registered_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let manual_code_file = dir.path().join("manual-code.txt");
        let sessions = OAuthLoginSessions::default();
        register_oauth_login_session(&sessions, "oauth_test", &manual_code_file).unwrap();

        let input = SubmitOAuthManualCodeInput {
            login_id: "oauth_test".to_string(),
            code: "  https://localhost/callback?code=abc  ".to_string(),
        };

        submit_oauth_manual_code_to_session(&sessions, input).unwrap();

        assert_eq!(
            fs::read_to_string(manual_code_file).unwrap(),
            "https://localhost/callback?code=abc"
        );
    }

    #[test]
    fn oauth_login_session_guard_cleans_registration_and_manual_code_file() {
        let dir = tempfile::tempdir().unwrap();
        let manual_code_file = dir.path().join("manual-code.txt");
        let sessions = OAuthLoginSessions::default();
        fs::write(&manual_code_file, "stale-code").unwrap();

        {
            let _guard = OAuthLoginSessionGuard::register(
                &sessions,
                "oauth_test".to_string(),
                manual_code_file.clone(),
            )
            .unwrap();
            assert!(sessions
                .manual_code_files
                .lock()
                .unwrap()
                .contains_key("oauth_test"));
        }

        assert!(!manual_code_file.exists());
        assert!(!sessions
            .manual_code_files
            .lock()
            .unwrap()
            .contains_key("oauth_test"));
        let err = submit_oauth_manual_code_to_session(
            &sessions,
            SubmitOAuthManualCodeInput {
                login_id: "oauth_test".to_string(),
                code: "code".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err.code, "VALIDATION_FAILED");
    }

    #[test]
    fn parses_pi_models_json() {
        let output = r#"
[
  { "provider": "openai", "id": "gpt-5.5", "contextWindow": 272000, "maxTokens": 128000, "reasoning": true, "input": ["text", "image"] },
  { "provider": "anthropic", "id": "claude-sonnet-4-6", "contextWindow": 1000000, "maxTokens": 64000, "reasoning": true, "input": ["text", "image"] }
]
"#;

        let models = parse_pi_models_json(output).unwrap();
        assert_eq!(
            models,
            vec![
                PiModelInfo {
                    provider: "openai".to_string(),
                    id: "gpt-5.5".to_string(),
                    context: "272K".to_string(),
                    max_out: "128K".to_string(),
                    thinking: true,
                    images: true,
                },
                PiModelInfo {
                    provider: "anthropic".to_string(),
                    id: "claude-sonnet-4-6".to_string(),
                    context: "1M".to_string(),
                    max_out: "64K".to_string(),
                    thinking: true,
                    images: true,
                },
            ]
        );
    }

    #[test]
    fn parses_pi_models_table_for_provider() {
        let output = r#"
provider  model                  context  max-out  thinking  images
BM        gpt-5.4                128K     16.4K    no        no
openai    gpt-5.5                272K     128K     yes       yes
openai    o3-mini                200K     100K     yes       no
"#;

        assert_eq!(
            parse_pi_models_table(output, "openai").unwrap(),
            vec![
                PiModelInfo {
                    provider: "openai".to_string(),
                    id: "gpt-5.5".to_string(),
                    context: "272K".to_string(),
                    max_out: "128K".to_string(),
                    thinking: true,
                    images: true,
                },
                PiModelInfo {
                    provider: "openai".to_string(),
                    id: "o3-mini".to_string(),
                    context: "200K".to_string(),
                    max_out: "100K".to_string(),
                    thinking: true,
                    images: false,
                },
            ]
        );
    }

    #[test]
    fn model_fetch_urls_falls_back_to_v1_once() {
        assert_eq!(
            model_fetch_urls("http://localhost:8080"),
            vec![
                "http://localhost:8080/models".to_string(),
                "http://localhost:8080/v1/models".to_string()
            ]
        );
        assert_eq!(
            model_fetch_urls("http://localhost:8080/v1"),
            vec!["http://localhost:8080/v1/models".to_string()]
        );
    }

    #[test]
    fn parses_openai_model_list() {
        let value = json!({
            "object": "list",
            "data": [
                { "id": "gpt-5.4", "object": "model" },
                { "id": "gpt-5.5", "type": "model" }
            ]
        });
        assert_eq!(
            parse_openai_model_list(&value).unwrap(),
            vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()]
        );
    }

    #[test]
    fn normalize_config_trims_saved_secret_fields_without_touching_model_ids() {
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some("provider_custom".to_string()),
            providers: vec![custom_provider()],
        };

        let normalized = normalize_app_config(config);
        match &normalized.providers[0] {
            Provider::Custom(provider) => {
                assert_eq!(provider.name, "Relay");
                assert_eq!(provider.base_url, "https://relay.example.com/v1");
                assert_eq!(provider.api_key, "relay-key");
                assert_eq!(provider.models[0].id, "deepseek chat");
            }
            Provider::Official(_) => panic!("expected custom provider"),
        }
    }

    #[test]
    fn normalize_config_migrates_v2_official_provider_defaults() {
        let config: AppConfig = serde_json::from_value(json!({
            "schemaVersion": 2,
            "theme": "system",
            "activeProviderId": "provider_official",
            "providers": [{
                "kind": "official",
                "id": "provider_official",
                "name": "OpenAI",
                "providerId": "openai",
                "models": [{ "id": "gpt-5.5" }],
                "defaultModelId": "gpt-5.5"
            }]
        }))
        .unwrap();

        let normalized = normalize_app_config(config);

        assert_eq!(normalized.schema_version, SCHEMA_VERSION);
        let Provider::Official(provider) = &normalized.providers[0] else {
            unreachable!();
        };
        assert!(matches!(provider.auth_mode, AuthMode::Existing));
        assert!(provider.auth_account_id.is_none());
        assert_eq!(provider.api_key, "");
        validate_app_config(&normalized).unwrap();
    }

    #[test]
    fn apply_provider_writes_pi_files_in_expected_shape() {
        let dir = tempfile::tempdir().unwrap();
        let pi_agent_dir = dir.path().join(".pi").join("agent");
        fs::create_dir_all(&pi_agent_dir).unwrap();
        fs::write(
            pi_agent_dir.join("auth.json"),
            r#"{ "anthropic": { "type": "oauth", "accessToken": "keep" } }"#,
        )
        .unwrap();
        fs::write(
            pi_agent_dir.join("settings.json"),
            r#"{ "theme": "dark", "sessionDir": "keep" }"#,
        )
        .unwrap();

        let paths = Paths {
            app_config_dir: dir.path().join("PiSwitch"),
            app_config_file: dir.path().join("PiSwitch").join("config.json"),
            accounts_file: dir.path().join("PiSwitch").join("accounts.json"),
            pi_agent_dir: pi_agent_dir.clone(),
            pi_models_file: pi_agent_dir.join("models.json"),
            pi_auth_file: pi_agent_dir.join("auth.json"),
            pi_settings_file: pi_agent_dir.join("settings.json"),
            home: dir.path().to_path_buf(),
        };
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some("provider_custom".to_string()),
            providers: vec![custom_provider()],
        };

        apply_provider(&config, "provider_custom", &paths).unwrap();

        let models: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_models_file).unwrap()).unwrap();
        let auth: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_auth_file).unwrap()).unwrap();
        let settings: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_settings_file).unwrap()).unwrap();
        assert_eq!(models["providers"]["Relay"]["api"], "openai-completions");
        assert_eq!(auth["anthropic"]["type"], "oauth");
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["sessionDir"], "keep");
        assert_eq!(settings["defaultProvider"], "Relay");
        assert_eq!(settings["defaultModel"], "deepseek chat");
        assert_eq!(settings["enabledModels"], json!(["deepseek chat"]));
    }

    #[test]
    fn apply_provider_api_key_mode_persists_refreshed_previous_oauth_account() {
        let dir = tempfile::tempdir().unwrap();
        let app_config_dir = dir.path().join("PiSwitch");
        let pi_agent_dir = dir.path().join(".pi").join("agent");
        fs::create_dir_all(&pi_agent_dir).unwrap();
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::write(
            pi_agent_dir.join("auth.json"),
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-a-refreshed" } }"#,
        )
        .unwrap();
        fs::write(pi_agent_dir.join("settings.json"), r#"{}"#).unwrap();
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.last_applied_at = Some("100".to_string());
        save_accounts_store_to_path(
            &app_config_dir.join("accounts.json"),
            &AccountsStore {
                version: ACCOUNTS_VERSION,
                accounts: vec![account],
            },
        )
        .unwrap();
        let paths = Paths {
            app_config_dir: app_config_dir.clone(),
            app_config_file: app_config_dir.join("config.json"),
            accounts_file: app_config_dir.join("accounts.json"),
            pi_agent_dir: pi_agent_dir.clone(),
            pi_models_file: pi_agent_dir.join("models.json"),
            pi_auth_file: pi_agent_dir.join("auth.json"),
            pi_settings_file: pi_agent_dir.join("settings.json"),
            home: dir.path().to_path_buf(),
        };
        let mut provider = match official_provider() {
            Provider::Official(provider) => provider,
            Provider::Custom(_) => unreachable!(),
        };
        provider.provider_id = "openai-codex".to_string();
        provider.auth_mode = AuthMode::ApiKey;
        provider.api_key = "sk-new".to_string();
        provider.models[0].id = "codex-test-model".to_string();
        provider.default_model_id = "codex-test-model".to_string();
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some(provider.id.clone()),
            providers: vec![Provider::Official(provider)],
        };

        apply_provider(&config, "provider_official", &paths).unwrap();

        let store = load_accounts_store_from_path(&paths.accounts_file).unwrap();
        assert_eq!(
            store.accounts[0].credential["accessToken"],
            "token-a-refreshed"
        );
        let auth: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_auth_file).unwrap()).unwrap();
        assert_eq!(auth["openai-codex"]["key"], "sk-new");
    }

    #[test]
    fn apply_provider_account_mode_reapplying_current_account_keeps_refreshed_oauth() {
        let dir = tempfile::tempdir().unwrap();
        let app_config_dir = dir.path().join("PiSwitch");
        let pi_agent_dir = dir.path().join(".pi").join("agent");
        fs::create_dir_all(&pi_agent_dir).unwrap();
        fs::create_dir_all(&app_config_dir).unwrap();
        fs::write(
            pi_agent_dir.join("auth.json"),
            r#"{ "openai-codex": { "type": "oauth", "accessToken": "token-a-refreshed" } }"#,
        )
        .unwrap();
        fs::write(pi_agent_dir.join("settings.json"), r#"{}"#).unwrap();
        let mut account = test_account("codex_a", "openai-codex", "token-a");
        account.last_applied_at = Some("100".to_string());
        save_accounts_store_to_path(
            &app_config_dir.join("accounts.json"),
            &AccountsStore {
                version: ACCOUNTS_VERSION,
                accounts: vec![account],
            },
        )
        .unwrap();
        let paths = Paths {
            app_config_dir: app_config_dir.clone(),
            app_config_file: app_config_dir.join("config.json"),
            accounts_file: app_config_dir.join("accounts.json"),
            pi_agent_dir: pi_agent_dir.clone(),
            pi_models_file: pi_agent_dir.join("models.json"),
            pi_auth_file: pi_agent_dir.join("auth.json"),
            pi_settings_file: pi_agent_dir.join("settings.json"),
            home: dir.path().to_path_buf(),
        };
        let mut provider = match official_provider_using_account("codex_a") {
            Provider::Official(provider) => provider,
            Provider::Custom(_) => unreachable!(),
        };
        provider.models[0].id = "codex-test-model".to_string();
        provider.default_model_id = "codex-test-model".to_string();
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some(provider.id.clone()),
            providers: vec![Provider::Official(provider)],
        };

        apply_provider(&config, "provider_official", &paths).unwrap();

        let store = load_accounts_store_from_path(&paths.accounts_file).unwrap();
        assert_eq!(
            store.accounts[0].credential["accessToken"],
            "token-a-refreshed"
        );
        let auth: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_auth_file).unwrap()).unwrap();
        assert_eq!(auth["openai-codex"]["accessToken"], "token-a-refreshed");
    }

    #[test]
    fn apply_provider_ignores_unselected_incomplete_provider() {
        let dir = tempfile::tempdir().unwrap();
        let pi_agent_dir = dir.path().join(".pi").join("agent");
        fs::create_dir_all(&pi_agent_dir).unwrap();
        let paths = Paths {
            app_config_dir: dir.path().join("PiSwitch"),
            app_config_file: dir.path().join("PiSwitch").join("config.json"),
            accounts_file: dir.path().join("PiSwitch").join("accounts.json"),
            pi_agent_dir: pi_agent_dir.clone(),
            pi_models_file: pi_agent_dir.join("models.json"),
            pi_auth_file: pi_agent_dir.join("auth.json"),
            pi_settings_file: pi_agent_dir.join("settings.json"),
            home: dir.path().to_path_buf(),
        };
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_provider_id: Some("provider_custom".to_string()),
            providers: vec![custom_provider(), incomplete_custom_provider()],
        };

        apply_provider(&config, "provider_custom", &paths).unwrap();
        assert!(validate_app_config(&config).is_err());

        let settings: Value =
            serde_json::from_str(&fs::read_to_string(paths.pi_settings_file).unwrap()).unwrap();
        assert_eq!(settings["defaultProvider"], "Relay");
        assert_eq!(settings["defaultModel"], "deepseek chat");
    }
}
