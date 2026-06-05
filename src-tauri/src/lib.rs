use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{timeout, Duration},
};

const SCHEMA_VERSION: u32 = 2;
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
    pub auth_mode: AuthMode,
    pub api_key: String,
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
    pub headers: Option<Vec<HeaderEntry>>,
    pub auth_header: Option<bool>,
    pub compat: Option<CompatConfig>,
    pub models: Vec<ModelConfig>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode {
    Existing,
    ApiKey,
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
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAdvancedConfig {
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub api_key: Option<String>,
    pub headers: Option<Vec<HeaderEntry>>,
    pub auth_header: Option<bool>,
    pub compat: Option<CompatConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    pub name: Option<String>,
    pub source: Option<ModelSource>,
    pub override_built_in: Option<bool>,
    pub api: Option<String>,
    pub reasoning: Option<bool>,
    pub input: Option<Vec<String>>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub cost: Option<CostConfig>,
    pub headers: Option<Vec<HeaderEntry>>,
    pub compat: Option<CompatConfig>,
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
}

#[derive(Debug, Clone)]
struct Paths {
    app_config_dir: PathBuf,
    app_config_file: PathBuf,
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
    let pi_agent_dir = home.join(".pi").join("agent");
    Ok(Paths {
        app_config_dir,
        app_config_file,
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
    run_pi_ping(&paths.home).await
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

    let url = format!("{base_url}/models");
    let value: Value = reqwest::Client::new()
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|err| {
            AppError::new("MODEL_FETCH_FAILED", "请求 /models 失败").with_details(err.to_string())
        })?
        .error_for_status()
        .map_err(|err| {
            AppError::new("MODEL_FETCH_FAILED", "/models 返回错误状态")
                .with_details(err.to_string())
        })?
        .json()
        .await
        .map_err(|err| {
            AppError::new("MODEL_FETCH_FAILED", "/models 响应不是可解析 JSON")
                .with_details(err.to_string())
        })?;

    let mut models = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("MODEL_FETCH_FAILED", "/models 响应缺少 data 数组"))?
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    Ok(FetchCustomProviderModelsResult { models })
}

#[tauri::command]
async fn list_pi_models(input: ListPiModelsInput) -> AppResult<ListPiModelsResult> {
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
        return Err(AppError::new("PI_MODEL_REGISTRY_FAILED", "读取 Pi 模型注册表失败")
            .with_details(String::from_utf8_lossy(&output.stderr).to_string()));
    }
    parse_pi_models_json(&String::from_utf8_lossy(&output.stdout))
        .map(|models| ListPiModelsResult { models })
}

fn validate_app_config(config: &AppConfig) -> AppResult<()> {
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
            provider.models = provider
                .models
                .into_iter()
                .map(normalize_model)
                .collect();
            Provider::Official(provider)
        }
        Provider::Custom(mut provider) => {
            provider.base_url = provider.base_url.trim().to_string();
            provider.api_key = provider.api_key.trim().to_string();
            provider.models = provider
                .models
                .into_iter()
                .map(normalize_model)
                .collect();
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

fn sanitize_provider_id(value: &str) -> String {
    value.chars().filter(|char| !char.is_whitespace()).collect()
}

fn apply_provider(config: &AppConfig, provider_entry_id: &str, paths: &Paths) -> AppResult<()> {
    validate_app_config(config)?;
    let provider = config
        .providers
        .iter()
        .find(|provider| self::provider_entry_id(provider) == provider_entry_id)
        .ok_or_else(|| validation_error("找不到要应用的供应商"))?;
    validate_provider(provider)?;

    let models_json = build_models_json(provider);
    let auth_json = build_auth_json(provider, &paths.pi_auth_file)?;
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
    Ok(())
}

fn build_models_json(provider: &Provider) -> Value {
    match provider {
        Provider::Official(provider) => {
            let mut provider_object = Map::new();
            if let Some(advanced) = &provider.advanced {
                insert_trimmed_string(&mut provider_object, "baseUrl", advanced.base_url.as_deref());
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

fn build_auth_json(provider: &Provider, path: &Path) -> AppResult<Value> {
    let mut auth = read_json_object(path, "PI_AUTH_WRITE_FAILED", "auth.json")?;
    if let Provider::Official(provider) = provider {
        if matches!(provider.auth_mode, AuthMode::ApiKey) {
            auth.insert(
                provider.provider_id.clone(),
                json!({
                    "type": "api_key",
                    "key": provider.api_key.trim()
                }),
            );
        }
    }
    Ok(Value::Object(auth))
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

fn insert_model_optional_fields(object: &mut Map<String, Value>, model: &ModelConfig, include_api: bool) {
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
    insert_trimmed_string(&mut object, "maxTokensField", compat.max_tokens_field.as_deref());
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
    insert_trimmed_string(&mut object, "thinkingFormat", compat.thinking_format.as_deref());
    insert_bool(&mut object, "zaiToolStream", compat.zai_tool_stream);
    insert_bool(&mut object, "supportsStrictMode", compat.supports_strict_mode);
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
    insert_bool(&mut object, "sendSessionIdHeader", compat.send_session_id_header);
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
    insert_bool(&mut object, "allowEmptySignature", compat.allow_empty_signature);
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
    insert_bool(&mut object, "require_parameters", routing.require_parameters);
    insert_trimmed_string(&mut object, "data_collection", routing.data_collection.as_deref());
    insert_bool(&mut object, "zdr", routing.zdr);
    insert_bool(
        &mut object,
        "enforce_distillable_text",
        routing.enforce_distillable_text,
    );
    insert_string_array(&mut object, "order", routing.order.as_deref());
    insert_string_array(&mut object, "only", routing.only.as_deref());
    insert_string_array(&mut object, "ignore", routing.ignore.as_deref());
    insert_string_array(&mut object, "quantizations", routing.quantizations.as_deref());
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

async fn run_pi_ping(home: &Path) -> AppResult<TestProviderResult> {
    let mut child = Command::new("pi")
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
        return Err(AppError::new(
            "PI_COMMAND_NOT_FOUND",
            "当前 GUI 环境无法找到 pi 命令",
        )
        .with_details(String::from_utf8_lossy(&output.stderr).to_string()));
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
        AppError::new("PI_MODELS_PARSE_FAILED", "Pi 模型输出无法解析")
            .with_details(err.to_string())
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            list_pi_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn official_provider() -> Provider {
        Provider::Official(OfficialProvider {
            id: "provider_official".to_string(),
            name: "OpenAI Daily".to_string(),
            provider_id: "openai".to_string(),
            auth_mode: AuthMode::ApiKey,
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

    fn official_provider_with_custom_and_override() -> Provider {
        Provider::Official(OfficialProvider {
            id: "provider_official".to_string(),
            name: "OpenAI Daily".to_string(),
            provider_id: "openai".to_string(),
            auth_mode: AuthMode::Existing,
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

        let value = build_auth_json(&official_provider(), &path).unwrap();
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

        let value = build_auth_json(&custom_provider(), &path).unwrap();
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

        let value = build_auth_json(&official_provider_with_custom_and_override(), &path).unwrap();
        assert_eq!(value["openai"]["type"], "oauth");
        assert_eq!(value["openai"]["accessToken"], "keep");
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
        assert_eq!(provider["models"][0]["headers"]["x-model-key"], "$MODEL_KEY");
        assert_eq!(provider["models"][0]["compat"]["supportsDeveloperRole"], false);
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
}
