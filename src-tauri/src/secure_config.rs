use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "com.prosemap.editor.model-config";
const KEYRING_ACCOUNT: &str = "default";
static KEYRING_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Provider {
    Openai,
    Anthropic,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    provider: Provider,
    base_url: String,
    model: String,
    api_key: String,
}

fn validate_config(config: &ModelConfig) -> Result<(), String> {
    if config.api_key.trim().is_empty() || config.api_key.len() > 2_048 {
        return Err("API 密钥无效".to_string());
    }
    if config.model.trim().is_empty() || config.model.len() > 160 {
        return Err("模型名称无效".to_string());
    }
    if config.base_url.trim().is_empty() || config.base_url.len() > 2_048 {
        return Err("API 地址无效".to_string());
    }

    let url = url::Url::parse(config.base_url.trim()).map_err(|_| "API 地址无效".to_string())?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("API 地址必须使用 HTTPS".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含凭据、查询参数或锚点".to_string());
    }
    Ok(())
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|_| "无法访问系统安全凭据库".to_string())
}

fn save_config(config: ModelConfig) -> Result<(), String> {
    validate_config(&config)?;
    let serialized = serde_json::to_string(&config).map_err(|_| "无法保存模型配置".to_string())?;
    keyring_entry()?
        .set_password(&serialized)
        .map_err(|_| "无法将模型配置写入系统安全凭据库".to_string())
}

fn load_config() -> Result<Option<ModelConfig>, String> {
    let serialized = match keyring_entry()?.get_password() {
        Ok(value) => value,
        Err(KeyringError::NoEntry) => return Ok(None),
        Err(_) => return Err("无法从系统安全凭据库读取模型配置".to_string()),
    };
    let config: ModelConfig = serde_json::from_str(&serialized)
        .map_err(|_| "系统安全凭据库中的模型配置已损坏，请重新保存".to_string())?;
    validate_config(&config)?;
    Ok(Some(config))
}

#[tauri::command]
pub async fn save_model_config(config: ModelConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEYRING_LOCK
            .lock()
            .map_err(|_| "系统安全凭据库锁已损坏".to_string())?;
        save_config(config)
    })
    .await
    .map_err(|_| "保存模型配置的后台任务意外结束".to_string())?
}

#[tauri::command]
pub async fn load_model_config() -> Result<Option<ModelConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = KEYRING_LOCK
            .lock()
            .map_err(|_| "系统安全凭据库锁已损坏".to_string())?;
        load_config()
    })
    .await
    .map_err(|_| "读取模型配置的后台任务意外结束".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config(base_url: &str) -> ModelConfig {
        ModelConfig {
            provider: Provider::Openai,
            base_url: base_url.to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: "secret".to_string(),
        }
    }

    #[test]
    fn config_serialization_matches_the_typescript_contract() {
        let value = serde_json::to_value(valid_config("https://gateway.example.com:8443/v1"))
            .expect("serialize model config");
        assert_eq!(value["provider"], "openai");
        assert_eq!(value["baseUrl"], "https://gateway.example.com:8443/v1");
        assert_eq!(value["model"], "gpt-4.1-mini");
        assert_eq!(value["apiKey"], "secret");
    }

    #[test]
    fn accepts_https_urls_with_explicit_ports() {
        assert!(validate_config(&valid_config("https://gateway.example.com:8443/v1")).is_ok());
    }

    #[test]
    fn rejects_plaintext_and_credentialed_urls() {
        assert!(validate_config(&valid_config("http://gateway.example.com/v1")).is_err());
        assert!(validate_config(&valid_config("https://token@gateway.example.com/v1")).is_err());
    }
}
