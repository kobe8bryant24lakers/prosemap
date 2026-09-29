use crate::endpoint::parse_base_url;
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

    parse_base_url(&config.base_url)?;
    Ok(())
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    id: String,
    name: String,
    #[serde(flatten)]
    config: ModelConfig,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfiles {
    profiles: Vec<ModelProfile>,
    active_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileIndex {
    accounts: Vec<String>,
    active_id: Option<String>,
}

const PROFILES_ACCOUNT: &str = "profiles-v1";

fn validate_profiles(settings: &ModelProfiles) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if settings.profiles.len() > 20 {
        return Err("最多保存 20 个模型配置".into());
    }
    for profile in &settings.profiles {
        if profile.id.is_empty()
            || profile.id.len() > 80
            || !ids.insert(&profile.id)
            || profile.name.trim().is_empty()
            || profile.name.chars().count() > 160
        {
            return Err("模型配置名称或标识无效".into());
        }
        validate_config(&profile.config)?;
    }
    if settings.profiles.is_empty() && settings.active_id.is_none()
        || settings
            .active_id
            .as_ref()
            .is_some_and(|id| ids.contains(id))
    {
        Ok(())
    } else {
        Err("当前模型配置不存在".into())
    }
}

trait CredentialStore {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str);
}

struct SystemStore;

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account).map_err(|_| "无法访问系统安全凭据库".to_string())
}

impl CredentialStore for SystemStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err("无法从系统安全凭据库读取模型配置".into()),
        }
    }
    fn write(&self, account: &str, value: &str) -> Result<(), String> {
        entry(account)?
            .set_password(value)
            .map_err(|_| "无法将模型配置写入系统安全凭据库".into())
    }
    fn delete(&self, account: &str) {
        if let Ok(entry) = entry(account) {
            let _ = entry.delete_credential();
        }
    }
}

fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|_| "系统安全凭据库中的模型配置已损坏，请重新保存".into())
}

fn read_index(store: &impl CredentialStore) -> Result<Option<ProfileIndex>, String> {
    store
        .read(PROFILES_ACCOUNT)?
        .map(|value| decode(&value))
        .transpose()
}

fn load_profiles(store: &impl CredentialStore) -> Result<Option<ModelProfiles>, String> {
    if let Some(index) = read_index(store)? {
        let profiles = index
            .accounts
            .iter()
            .map(|account| {
                let value = store
                    .read(account)?
                    .ok_or("系统安全凭据库中的模型配置已损坏，请重新保存")?;
                decode(&value)
            })
            .collect::<Result<Vec<ModelProfile>, String>>()?;
        let settings = ModelProfiles {
            profiles,
            active_id: index.active_id,
        };
        validate_profiles(&settings)?;
        return Ok(Some(settings));
    }
    // Keep the old entry until the first successful multi-profile save.
    let Some(value) = store.read(KEYRING_ACCOUNT)? else {
        return Ok(None);
    };
    let config: ModelConfig = decode(&value)?;
    validate_config(&config)?;
    Ok(Some(ModelProfiles {
        profiles: vec![ModelProfile {
            id: "legacy".into(),
            name: config.model.clone(),
            config,
        }],
        active_id: Some("legacy".into()),
    }))
}

fn save_profiles(
    store: &impl CredentialStore,
    settings: &ModelProfiles,
    revision: &str,
) -> Result<(), String> {
    validate_profiles(settings)?;
    let previous = read_index(store)?;
    let mut accounts = Vec::new();
    // Stage separate credential entries, then commit the index. A failed write
    // leaves the previous collection readable and does not mix old/new secrets.
    let result = (|| {
        for (position, profile) in settings.profiles.iter().enumerate() {
            let account = format!("profile-{revision}-{position}");
            let serialized = serde_json::to_string(profile).map_err(|_| "无法保存模型配置")?;
            accounts.push(account.clone());
            store.write(&account, &serialized)?;
        }
        let index = ProfileIndex {
            accounts: accounts.clone(),
            active_id: settings.active_id.clone(),
        };
        store.write(
            PROFILES_ACCOUNT,
            &serde_json::to_string(&index).map_err(|_| "无法保存模型配置")?,
        )
    })();
    if result.is_err() {
        for account in &accounts {
            store.delete(account);
        }
        return result;
    }
    if let Some(previous) = previous {
        for account in previous.accounts {
            store.delete(&account);
        }
    }
    store.delete(KEYRING_ACCOUNT);
    Ok(())
}

#[tauri::command]
pub async fn save_model_profiles(settings: ModelProfiles) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEYRING_LOCK.lock().map_err(|_| "系统安全凭据库锁已损坏")?;
        let revision = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "无法保存模型配置")?
            .as_nanos()
            .to_string();
        save_profiles(&SystemStore, &settings, &revision)
    })
    .await
    .map_err(|_| "保存模型配置的后台任务意外结束".to_string())?
}

fn select_profile(store: &impl CredentialStore, id: &str) -> Result<(), String> {
    let settings = load_profiles(store)?.ok_or("当前模型配置不存在")?;
    if !settings.profiles.iter().any(|profile| profile.id == id) {
        return Err("当前模型配置不存在".into());
    }
    // A migrated legacy entry already has its only profile selected.
    if let Some(mut index) = read_index(store)? {
        index.active_id = Some(id.to_string());
        store.write(
            PROFILES_ACCOUNT,
            &serde_json::to_string(&index).map_err(|_| "无法保存模型配置")?,
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn select_model_profile(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEYRING_LOCK.lock().map_err(|_| "系统安全凭据库锁已损坏")?;
        select_profile(&SystemStore, &id)
    })
    .await
    .map_err(|_| "保存模型配置的后台任务意外结束".to_string())?
}

#[tauri::command]
pub async fn load_model_profiles() -> Result<Option<ModelProfiles>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = KEYRING_LOCK.lock().map_err(|_| "系统安全凭据库锁已损坏")?;
        load_profiles(&SystemStore)
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
    fn accepts_domains_and_ip_addresses_with_optional_ports() {
        assert!(validate_config(&valid_config("https://gateway.example.com:8443/v1")).is_ok());
        assert!(validate_config(&valid_config("https://203.0.113.10/v1")).is_ok());
        assert!(validate_config(&valid_config("https://[2001:db8::10]:8443/v1")).is_ok());
        assert!(validate_config(&valid_config("http://127.0.0.1:11434/v1")).is_ok());
        assert!(validate_config(&valid_config("http://192.168.1.20:8080/v1")).is_ok());
        assert!(validate_config(&valid_config("http://[::1]:11434/v1")).is_ok());
    }

    #[test]
    fn rejects_public_plaintext_ip_and_credentialed_urls() {
        assert!(validate_config(&valid_config("http://8.8.8.8/v1")).is_err());
        assert!(validate_config(&valid_config("https://token@gateway.example.com/v1")).is_err());
    }
    #[derive(Default)]
    struct MemoryStore {
        values: std::cell::RefCell<std::collections::HashMap<String, String>>,
        fail_account: std::cell::RefCell<Option<String>>,
    }
    impl CredentialStore for MemoryStore {
        fn read(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.values.borrow().get(account).cloned())
        }
        fn write(&self, account: &str, value: &str) -> Result<(), String> {
            if self.fail_account.borrow().as_deref() == Some(account) {
                return Err("simulated failure".into());
            }
            self.values
                .borrow_mut()
                .insert(account.into(), value.into());
            Ok(())
        }
        fn delete(&self, account: &str) {
            self.values.borrow_mut().remove(account);
        }
    }
    fn profiles() -> ModelProfiles {
        ModelProfiles {
            profiles: vec![
                ModelProfile {
                    id: "one".into(),
                    name: "Writing".into(),
                    config: valid_config("https://one.example/v1"),
                },
                ModelProfile {
                    id: "two".into(),
                    name: "Diagrams".into(),
                    config: ModelConfig {
                        provider: Provider::Anthropic,
                        api_key: "other-secret".into(),
                        ..valid_config("https://two.example")
                    },
                },
            ],
            active_id: Some("two".into()),
        }
    }
    #[test]
    fn profiles_round_trip_and_switch_without_rewriting_credentials() {
        let store = MemoryStore::default();
        let mut settings = profiles();
        save_profiles(&store, &settings, "first").unwrap();
        assert!(load_profiles(&store).unwrap() == Some(settings.clone()));
        let credentials = store.read("profile-first-0").unwrap();
        select_profile(&store, "one").unwrap();
        settings.active_id = Some("one".into());
        assert!(load_profiles(&store).unwrap() == Some(settings));
        assert_eq!(store.read("profile-first-0").unwrap(), credentials);
        assert!(select_profile(&store, "missing").is_err());
    }
    #[test]
    fn legacy_config_is_preserved_until_successful_migration() {
        let store = MemoryStore::default();
        store
            .write(
                KEYRING_ACCOUNT,
                &serde_json::to_string(&valid_config("https://old.example")).unwrap(),
            )
            .unwrap();
        let settings = load_profiles(&store).unwrap().unwrap();
        assert_eq!(settings.active_id.as_deref(), Some("legacy"));
        assert_eq!(settings.profiles[0].config.api_key, "secret");
        assert!(store.read(KEYRING_ACCOUNT).unwrap().is_some());
        save_profiles(&store, &settings, "migration").unwrap();
        assert!(store.read(KEYRING_ACCOUNT).unwrap().is_none());
        assert!(load_profiles(&store).unwrap() == Some(settings));
    }
    #[test]
    fn failed_staging_or_index_commit_keeps_previous_profiles() {
        for failure in ["profile-new-1", PROFILES_ACCOUNT] {
            let store = MemoryStore::default();
            let original = profiles();
            save_profiles(&store, &original, "old").unwrap();
            *store.fail_account.borrow_mut() = Some(failure.into());
            let mut changed = original.clone();
            changed.profiles[0].config.api_key = "replacement".into();
            assert!(save_profiles(&store, &changed, "new").is_err());
            assert!(load_profiles(&store).unwrap() == Some(original));
            assert_eq!(store.values.borrow().len(), 3);
        }
    }
    #[test]
    fn deleting_profiles_cleans_credentials_and_empty_state_does_not_revive_legacy() {
        let store = MemoryStore::default();
        save_profiles(&store, &profiles(), "old").unwrap();
        let empty = ModelProfiles {
            profiles: vec![],
            active_id: None,
        };
        save_profiles(&store, &empty, "empty").unwrap();
        assert_eq!(store.values.borrow().len(), 1);
        store
            .write(
                KEYRING_ACCOUNT,
                &serde_json::to_string(&valid_config("https://old.example")).unwrap(),
            )
            .unwrap();
        assert!(load_profiles(&store).unwrap() == Some(empty));
    }
    #[test]
    fn rejects_duplicate_ids_invalid_selection_and_invalid_credentials() {
        let mut settings = profiles();
        settings.profiles[1].id = "one".into();
        assert!(validate_profiles(&settings).is_err());
        settings = profiles();
        settings.active_id = Some("missing".into());
        assert!(validate_profiles(&settings).is_err());
        settings = profiles();
        settings.profiles[0].config.api_key.clear();
        assert!(validate_profiles(&settings).is_err());
    }
    #[test]
    fn failed_selection_does_not_change_the_active_model() {
        let store = MemoryStore::default();
        let settings = profiles();
        save_profiles(&store, &settings, "first").unwrap();
        *store.fail_account.borrow_mut() = Some(PROFILES_ACCOUNT.into());
        assert!(select_profile(&store, "one").is_err());
        assert!(load_profiles(&store).unwrap() == Some(settings));
    }
}
