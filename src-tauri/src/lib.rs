use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashSet,
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

const SCHEMA_VERSION: u32 = 1;
const OFFICIAL_PROVIDER_IDS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "groq",
    "mistral",
    "xai",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub language: Option<Language>,
    pub theme: ThemeMode,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
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
pub enum Profile {
    Official(OfficialProfile),
    Custom(CustomProfile),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialProfile {
    pub id: String,
    pub name: String,
    pub provider_id: OfficialProviderId,
    pub api_key: String,
    pub models: Vec<ModelEntry>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub provider_name: Option<String>,
    pub base_url: String,
    pub api: String,
    pub api_key: String,
    pub models: Vec<ModelEntry>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OfficialProviderId {
    Openai,
    Anthropic,
    Google,
    Openrouter,
    Groq,
    Mistral,
    Xai,
}

impl OfficialProviderId {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
            Self::Openrouter => "openrouter",
            Self::Groq => "groq",
            Self::Mistral => "mistral",
            Self::Xai => "xai",
        }
    }
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
pub struct ApplyProfileInput {
    pub config: AppConfig,
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProfileInput {
    pub config: AppConfig,
    pub profile_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProfileResult {
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
        active_profile_id: None,
        profiles: Vec::new(),
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

    let text = fs::read_to_string(&paths.app_config_file)
        .map_err(|err| AppError::new("CONFIG_PARSE_FAILED", "读取 GUI 配置失败").with_details(err.to_string()))?;
    let config: AppConfig = serde_json::from_str(&text)
        .map_err(|err| AppError::new("CONFIG_PARSE_FAILED", "GUI 配置 JSON 无法解析").with_details(err.to_string()))?;
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
    fs::create_dir_all(&paths.app_config_dir)
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "创建 PiSwitch 配置目录失败").with_details(err.to_string()))?;
    atomic_write_json(&paths.app_config_file, &config)
        .map_err(|err| err.with_file("config.json", &[]))
}

#[tauri::command]
fn apply_profile_to_pi(input: ApplyProfileInput) -> AppResult<()> {
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.pi_agent_dir)
        .map_err(|err| AppError::new("PI_MODELS_WRITE_FAILED", "创建 Pi 配置目录失败").with_details(err.to_string()))?;
    let config = normalize_app_config(input.config);
    apply_profile(&config, &input.profile_id, &paths)?;
    Ok(())
}

#[tauri::command]
async fn test_profile(input: TestProfileInput) -> AppResult<TestProfileResult> {
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.pi_agent_dir)
        .map_err(|err| AppError::new("PI_MODELS_WRITE_FAILED", "创建 Pi 配置目录失败").with_details(err.to_string()))?;
    let config = normalize_app_config(input.config);
    apply_profile(&config, &input.profile_id, &paths)?;
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
        .map_err(|err| AppError::new("MODEL_FETCH_FAILED", "请求 /models 失败").with_details(err.to_string()))?
        .error_for_status()
        .map_err(|err| AppError::new("MODEL_FETCH_FAILED", "/models 返回错误状态").with_details(err.to_string()))?
        .json()
        .await
        .map_err(|err| AppError::new("MODEL_FETCH_FAILED", "/models 响应不是可解析 JSON").with_details(err.to_string()))?;

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

fn validate_app_config(config: &AppConfig) -> AppResult<()> {
    if config.schema_version != SCHEMA_VERSION {
        return Err(AppError::new(
            "UNSUPPORTED_SCHEMA_VERSION",
            format!("不支持的 schemaVersion: {}", config.schema_version),
        ));
    }

    let mut ids = HashSet::new();
    for profile in &config.profiles {
        let id = profile_id(profile);
        if id.is_empty() {
            return Err(validation_error("Profile ID 不能为空"));
        }
        if !ids.insert(id.to_string()) {
            return Err(validation_error(format!("Profile ID 重复: {id}")));
        }
        validate_profile(profile)?;
    }

    if let Some(active_id) = &config.active_profile_id {
        if !config.profiles.iter().any(|profile| profile_id(profile) == active_id) {
            return Err(validation_error("activeProfileId 必须匹配现有 Profile"));
        }
    }
    Ok(())
}

fn validate_profile(profile: &Profile) -> AppResult<()> {
    let (name, api_key, models, default_model_id) = match profile {
        Profile::Official(profile) => (
            profile.name.as_str(),
            profile.api_key.as_str(),
            &profile.models,
            profile.default_model_id.as_str(),
        ),
        Profile::Custom(profile) => (
            profile.name.as_str(),
            profile.api_key.as_str(),
            &profile.models,
            profile.default_model_id.as_str(),
        ),
    };

    if name.trim().is_empty() {
        return Err(validation_error("Profile 名称不能为空"));
    }
    if api_key.trim().is_empty() {
        return Err(validation_error("API Key 不能为空"));
    }
    if models.is_empty() {
        return Err(validation_error("模型列表至少需要一个模型"));
    }
    if !models.iter().any(|model| model.id == default_model_id) {
        return Err(validation_error("默认模型必须存在于模型列表中"));
    }

    if let Profile::Custom(profile) = profile {
        let provider_id = sanitize_provider_id(&profile.provider_id);
        if provider_id.is_empty() {
            return Err(validation_error("自定义 Provider ID 不能为空"));
        }
        if OFFICIAL_PROVIDER_IDS.contains(&provider_id.as_str()) {
            return Err(validation_error("自定义 Provider ID 不能与内置 provider 冲突"));
        }
        if profile.base_url.trim().is_empty() {
            return Err(validation_error("Base URL 不能为空"));
        }
        if profile.api.is_empty() {
            return Err(validation_error("API 类型不能为空"));
        }
    }
    Ok(())
}

fn validation_error(message: impl Into<String>) -> AppError {
    AppError::new("VALIDATION_FAILED", message)
}

fn normalize_app_config(mut config: AppConfig) -> AppConfig {
    config.profiles = config
        .profiles
        .into_iter()
        .map(normalize_profile)
        .collect();
    config
}

fn normalize_profile(profile: Profile) -> Profile {
    match profile {
        Profile::Official(mut profile) => {
            profile.api_key = profile.api_key.trim().to_string();
            Profile::Official(profile)
        }
        Profile::Custom(mut profile) => {
            profile.provider_id = sanitize_provider_id(&profile.provider_id);
            profile.base_url = profile.base_url.trim().to_string();
            profile.api_key = profile.api_key.trim().to_string();
            Profile::Custom(profile)
        }
    }
}

fn profile_id(profile: &Profile) -> &str {
    match profile {
        Profile::Official(profile) => &profile.id,
        Profile::Custom(profile) => &profile.id,
    }
}

fn provider_id(profile: &Profile) -> String {
    match profile {
        Profile::Official(profile) => profile.provider_id.as_str().to_string(),
        Profile::Custom(profile) => sanitize_provider_id(&profile.provider_id),
    }
}

fn sanitize_provider_id(value: &str) -> String {
    value.chars().filter(|char| !char.is_whitespace()).collect()
}

fn apply_profile(config: &AppConfig, profile_id: &str, paths: &Paths) -> AppResult<()> {
    validate_app_config(config)?;
    let profile = config
        .profiles
        .iter()
        .find(|profile| self::profile_id(profile) == profile_id)
        .ok_or_else(|| validation_error("找不到要应用的 Profile"))?;
    validate_profile(profile)?;

    let models_json = build_models_json(profile);
    let auth_json = build_auth_json(profile, &paths.pi_auth_file)?;
    let settings_json = build_settings_json(profile, &paths.pi_settings_file)?;
    validate_pi_json(profile, &models_json, &auth_json, &settings_json)?;

    let mut written = Vec::new();
    write_pi_file(&paths.pi_models_file, &models_json, "models.json", "PI_MODELS_WRITE_FAILED", &written)?;
    written.push("models.json".to_string());
    write_pi_file(&paths.pi_auth_file, &auth_json, "auth.json", "PI_AUTH_WRITE_FAILED", &written)?;
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

fn build_models_json(profile: &Profile) -> Value {
    match profile {
        Profile::Official(_) => json!({ "providers": {} }),
        Profile::Custom(profile) => {
            let provider_id = sanitize_provider_id(&profile.provider_id);
            let mut provider = Map::new();
            if let Some(name) = &profile.provider_name {
                if !name.is_empty() {
                    provider.insert("name".to_string(), Value::String(name.clone()));
                }
            }
            provider.insert("baseUrl".to_string(), Value::String(profile.base_url.trim().to_string()));
            provider.insert("api".to_string(), Value::String(profile.api.clone()));
            provider.insert("apiKey".to_string(), Value::String(profile.api_key.trim().to_string()));
            provider.insert(
                "models".to_string(),
                Value::Array(
                    profile
                        .models
                        .iter()
                        .map(|model| json!({ "id": model.id }))
                        .collect(),
                ),
            );
            let mut providers = Map::new();
            providers.insert(provider_id, Value::Object(provider));
            json!({ "providers": providers })
        }
    }
}

fn build_auth_json(profile: &Profile, path: &Path) -> AppResult<Value> {
    let mut auth = read_json_object(path, "PI_AUTH_WRITE_FAILED", "auth.json")?;
    if let Profile::Official(profile) = profile {
        auth.insert(
            profile.provider_id.as_str().to_string(),
            json!({
                "type": "api_key",
                "key": profile.api_key.trim()
            }),
        );
    }
    Ok(Value::Object(auth))
}

fn build_settings_json(profile: &Profile, path: &Path) -> AppResult<Value> {
    let mut settings = read_json_object(path, "PI_SETTINGS_WRITE_FAILED", "settings.json")?;
    settings.insert("defaultProvider".to_string(), Value::String(provider_id(profile)));
    settings.insert(
        "defaultModel".to_string(),
        Value::String(match profile {
            Profile::Official(profile) => profile.default_model_id.clone(),
            Profile::Custom(profile) => profile.default_model_id.clone(),
        }),
    );
    Ok(Value::Object(settings))
}

fn read_json_object(path: &Path, code: &str, file_name: &str) -> AppResult<Map<String, Value>> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let text = fs::read_to_string(path)
        .map_err(|err| AppError::new(code, format!("读取 {file_name} 失败")).with_details(err.to_string()))?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|err| AppError::new(code, format!("{file_name} JSON 无法解析")).with_details(err.to_string()))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::new(code, format!("{file_name} 根节点必须是 JSON object")))
}

fn validate_pi_json(profile: &Profile, models: &Value, auth: &Value, settings: &Value) -> AppResult<()> {
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
    if default_provider != provider_id(profile) {
        return Err(validation_error("defaultProvider 与当前 Profile 不一致"));
    }
    let model_exists = match profile {
        Profile::Official(profile) => profile.models.iter().any(|model| model.id == default_model),
        Profile::Custom(profile) => profile.models.iter().any(|model| model.id == default_model),
    };
    if !model_exists {
        return Err(validation_error("defaultModel 与当前 Profile 模型列表不一致"));
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
    fs::create_dir_all(parent)
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "创建目标目录失败").with_details(err.to_string()))?;

    let json_text = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "序列化 JSON 失败").with_details(err.to_string()))?;
    let _: Value = serde_json::from_str(&json_text)
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "写入前 JSON 自检失败").with_details(err.to_string()))?;

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
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "创建临时文件失败").with_details(err.to_string()))?;
    tmp.write_all(json_text.as_bytes())
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "写入临时文件失败").with_details(err.to_string()))?;
    tmp.write_all(b"\n")
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "写入临时文件失败").with_details(err.to_string()))?;
    tmp.as_file()
        .sync_all()
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "刷新临时文件失败").with_details(err.to_string()))?;
    tmp.persist(target)
        .map_err(|err| AppError::new("APP_CONFIG_WRITE_FAILED", "替换目标文件失败").with_details(err.to_string()))?;
    Ok(())
}

async fn run_pi_ping(home: &Path) -> AppResult<TestProfileResult> {
    let mut child = Command::new("pi")
        .arg("-p")
        .arg("ping")
        .current_dir(home)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|err| AppError::new("PI_COMMAND_NOT_FOUND", "无法启动 pi 命令").with_details(err.to_string()))?;

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let wait_result = timeout(Duration::from_secs(15), child.wait()).await;
    let status = match wait_result {
        Ok(result) => result
            .map_err(|err| AppError::new("PI_TEST_FAILED", "等待 pi 命令失败").with_details(err.to_string()))?,
        Err(_) => {
            let _ = child.kill().await;
            let stdout = read_pipe(&mut stdout_pipe).await;
            let stderr = read_pipe(&mut stderr_pipe).await;
            return Ok(TestProfileResult {
                status: "timeout".to_string(),
                exit_code: None,
                stdout,
                stderr,
            });
        }
    };

    let stdout = read_pipe(&mut stdout_pipe).await;
    let stderr = read_pipe(&mut stderr_pipe).await;
    Ok(TestProfileResult {
        status: if status.success() { "success" } else { "failed" }.to_string(),
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
            apply_profile_to_pi,
            test_profile,
            fetch_custom_provider_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn official_profile() -> Profile {
        Profile::Official(OfficialProfile {
            id: "profile_official".to_string(),
            name: "OpenAI Daily".to_string(),
            provider_id: OfficialProviderId::Openai,
            api_key: "  sk-test  ".to_string(),
            models: vec![ModelEntry {
                id: "gpt-4o".to_string(),
                name: None,
            }],
            default_model_id: "gpt-4o".to_string(),
        })
    }

    fn custom_profile() -> Profile {
        Profile::Custom(CustomProfile {
            id: "profile_custom".to_string(),
            name: "Relay".to_string(),
            provider_id: " 我的 中转 ".to_string(),
            provider_name: Some("My Relay".to_string()),
            base_url: " https://relay.example.com/v1 ".to_string(),
            api: "openai-completions".to_string(),
            api_key: " relay-key ".to_string(),
            models: vec![ModelEntry {
                id: "deepseek chat".to_string(),
                name: None,
            }],
            default_model_id: "deepseek chat".to_string(),
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

        let value = build_auth_json(&official_profile(), &path).unwrap();
        assert_eq!(value["openai"], json!({ "type": "api_key", "key": "sk-test" }));
        assert_eq!(value["anthropic"]["type"], "oauth");
        assert_eq!(value["unknown"]["shape"], true);
    }

    #[test]
    fn custom_profile_does_not_write_auth_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        fs::write(&path, r#"{ "openai": { "type": "oauth", "accessToken": "keep" } }"#).unwrap();

        let value = build_auth_json(&custom_profile(), &path).unwrap();
        assert_eq!(value["openai"]["type"], "oauth");
        assert!(value.get("我的中转").is_none());
    }

    #[test]
    fn settings_preserves_other_fields_and_updates_default_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{ "theme": "dark", "defaultProvider": "old", "defaultModel": "old-model" }"#,
        )
        .unwrap();

        let value = build_settings_json(&custom_profile(), &path).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["defaultProvider"], "我的中转");
        assert_eq!(value["defaultModel"], "deepseek chat");
    }

    #[test]
    fn custom_models_json_uses_trimmed_fields_but_preserves_model_id() {
        let value = build_models_json(&custom_profile());
        let provider = &value["providers"]["我的中转"];
        assert_eq!(provider["baseUrl"], "https://relay.example.com/v1");
        assert_eq!(provider["apiKey"], "relay-key");
        assert_eq!(provider["models"][0]["id"], "deepseek chat");
    }

    #[test]
    fn normalize_config_trims_saved_secret_fields_without_touching_model_ids() {
        let config = AppConfig {
            schema_version: SCHEMA_VERSION,
            language: None,
            theme: ThemeMode::System,
            active_profile_id: Some("profile_custom".to_string()),
            profiles: vec![custom_profile()],
        };

        let normalized = normalize_app_config(config);
        match &normalized.profiles[0] {
            Profile::Custom(profile) => {
                assert_eq!(profile.provider_id, "我的中转");
                assert_eq!(profile.base_url, "https://relay.example.com/v1");
                assert_eq!(profile.api_key, "relay-key");
                assert_eq!(profile.models[0].id, "deepseek chat");
            }
            Profile::Official(_) => panic!("expected custom profile"),
        }
    }

    #[test]
    fn apply_profile_writes_pi_files_in_expected_shape() {
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
            active_profile_id: Some("profile_custom".to_string()),
            profiles: vec![custom_profile()],
        };

        apply_profile(&config, "profile_custom", &paths).unwrap();

        let models: Value = serde_json::from_str(&fs::read_to_string(paths.pi_models_file).unwrap()).unwrap();
        let auth: Value = serde_json::from_str(&fs::read_to_string(paths.pi_auth_file).unwrap()).unwrap();
        let settings: Value = serde_json::from_str(&fs::read_to_string(paths.pi_settings_file).unwrap()).unwrap();
        assert_eq!(models["providers"]["我的中转"]["api"], "openai-completions");
        assert_eq!(auth["anthropic"]["type"], "oauth");
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["sessionDir"], "keep");
        assert_eq!(settings["defaultProvider"], "我的中转");
        assert_eq!(settings["defaultModel"], "deepseek chat");
    }
}
