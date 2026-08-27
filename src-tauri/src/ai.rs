use crate::endpoint::{is_local_network_ip, is_unusable_destination, parse_base_url};
use futures_util::StreamExt;
use reqwest::{header, redirect::Policy, Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::Duration,
};
use tauri::{ipc::Channel, State};
use tokio::{net::lookup_host, sync::watch};
use url::Host;

const MAX_INPUT_CHARS: usize = 140_000;
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct AiState {
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Provider {
    Openai,
    Anthropic,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    request_id: String,
    provider: Provider,
    base_url: String,
    model: String,
    api_key: String,
    system: String,
    prompt: String,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Delta { text: String },
    Done,
    Error { message: String },
}

fn validate_request(request: &AiRequest) -> Result<(), String> {
    if request.request_id.trim().is_empty() || request.request_id.len() > 128 {
        return Err("请求标识无效".to_string());
    }
    if request.api_key.trim().is_empty() || request.api_key.len() > 2_048 {
        return Err("API 密钥无效".to_string());
    }
    if request.base_url.trim().is_empty() || request.base_url.len() > 2_048 {
        return Err("API 地址无效".to_string());
    }
    if request.model.is_empty()
        || request.model.len() > 160
        || !request
            .model
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_.:/@+-".contains(character))
    {
        return Err("模型名称包含不支持的字符".to_string());
    }
    let system_chars = request.system.chars().count();
    let prompt_chars = request.prompt.chars().count();
    if request.system.trim().is_empty()
        || request.prompt.trim().is_empty()
        || system_chars > 12_000
        || prompt_chars > 120_000
        || system_chars + prompt_chars > MAX_INPUT_CHARS
    {
        return Err("模型指令为空或超过长度限制".to_string());
    }
    if !request.temperature.is_finite() || !(0.0..=1.0).contains(&request.temperature) {
        return Err("temperature 必须在 0 到 1 之间".to_string());
    }
    if !(256..=8_192).contains(&request.max_tokens) {
        return Err("maxTokens 必须在 256 到 8192 之间".to_string());
    }
    Ok(())
}

fn resolve_endpoint(provider: Provider, base_url: &str) -> Result<Url, String> {
    let mut url = parse_base_url(base_url)?;

    let suffix = match provider {
        Provider::Openai => "/chat/completions",
        Provider::Anthropic => "/messages",
    };
    let path = url.path().trim_end_matches('/').to_string();
    let endpoint_path = if path.to_ascii_lowercase().ends_with(suffix) {
        path
    } else {
        format!("{path}{suffix}")
    };
    url.set_path(&endpoint_path);
    Ok(url)
}

fn validate_address_policy(scheme: &str, addresses: &[SocketAddr]) -> Result<(), String> {
    if addresses.is_empty() {
        return Err("API 主机名没有可用的网络地址".to_string());
    }
    if addresses
        .iter()
        .any(|address| is_unusable_destination(address.ip()))
    {
        return Err("API 地址解析到了不可用的网络地址".to_string());
    }
    if scheme == "http"
        && addresses
            .iter()
            .any(|address| !is_local_network_ip(address.ip()))
    {
        return Err("HTTP API 地址仅允许本机、私有网络或链路本地目标".to_string());
    }
    Ok(())
}

async fn resolve_addresses(url: &Url) -> Result<(Option<String>, Vec<SocketAddr>), String> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "API 地址缺少有效端口".to_string())?;
    let (domain, mut addresses) = match url
        .host()
        .ok_or_else(|| "API 地址缺少有效的主机名或 IP".to_string())?
    {
        Host::Domain(host) => {
            let host = host.to_string();
            let addresses = lookup_host((host.as_str(), port))
                .await
                .map_err(|_| "无法解析 API 主机名".to_string())?
                .collect();
            (Some(host), addresses)
        }
        Host::Ipv4(ip) => (None, vec![SocketAddr::new(IpAddr::V4(ip), port)]),
        Host::Ipv6(ip) => (None, vec![SocketAddr::new(IpAddr::V6(ip), port)]),
    };
    addresses.sort_unstable();
    addresses.dedup();
    validate_address_policy(url.scheme(), &addresses)?;
    Ok((domain, addresses))
}

fn safe_upstream_error(bytes: &[u8], api_key: &str) -> String {
    let fallback = "上游模型服务拒绝了本次请求";
    let message = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| fallback.to_string());
    message
        .replace(api_key, "[已隐藏]")
        .chars()
        .take(500)
        .collect()
}

fn extract_openai_text(payload: &Value) -> String {
    let Some(content) = payload.pointer("/choices/0/delta/content") else {
        return payload
            .pointer("/choices/0/text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect()
}

fn extract_anthropic_text(payload: &Value) -> String {
    if payload.get("type").and_then(Value::as_str) != Some("content_block_delta") {
        return String::new();
    }
    payload
        .pointer("/delta/text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn parse_sse_data(provider: Provider, data: &str) -> Result<(String, bool), String> {
    if data.trim() == "[DONE]" {
        return Ok((String::new(), true));
    }
    let payload: Value =
        serde_json::from_str(data).map_err(|_| "模型返回了无效的流式数据".to_string())?;
    if payload.get("error").is_some()
        || payload.get("type").and_then(Value::as_str) == Some("error")
    {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("上游模型服务返回错误");
        return Err(message.chars().take(500).collect());
    }

    let done = match provider {
        Provider::Openai => payload
            .pointer("/choices/0/finish_reason")
            .is_some_and(|value| !value.is_null()),
        Provider::Anthropic => payload.get("type").and_then(Value::as_str) == Some("message_stop"),
    };
    let text = match provider {
        Provider::Openai => extract_openai_text(&payload),
        Provider::Anthropic => extract_anthropic_text(&payload),
    };
    Ok((text, done))
}

fn extract_non_streaming_text(provider: Provider, payload: &Value) -> String {
    match provider {
        Provider::Openai => payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        Provider::Anthropic => payload
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect(),
    }
}

async fn read_limited_body(response: Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "读取模型响应失败".to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("模型响应超过大小限制".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn execute_stream(
    request: &AiRequest,
    channel: &Channel<AiEvent>,
    mut cancelled: watch::Receiver<bool>,
) -> Result<(), String> {
    validate_request(request)?;
    let endpoint = resolve_endpoint(request.provider, &request.base_url)?;
    let (endpoint_domain, resolved_addresses) = resolve_addresses(&endpoint).await?;

    let mut client_builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .user_agent("ProseMap/0.1");
    if let Some(domain) = endpoint_domain {
        client_builder = client_builder.resolve_to_addrs(&domain, &resolved_addresses);
    }
    let client = client_builder
        .build()
        .map_err(|_| "无法初始化安全网络客户端".to_string())?;

    let body = match request.provider {
        Provider::Openai => json!({
            "model": request.model.as_str(),
            "stream": true,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "messages": [
                { "role": "system", "content": request.system.as_str() },
                { "role": "user", "content": request.prompt.as_str() }
            ]
        }),
        Provider::Anthropic => json!({
            "model": request.model.as_str(),
            "stream": true,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "system": request.system.as_str(),
            "messages": [{ "role": "user", "content": request.prompt.as_str() }]
        }),
    };

    let mut builder = client
        .post(endpoint)
        .header(header::ACCEPT, "text/event-stream")
        .header(header::CONTENT_TYPE, "application/json")
        .json(&body);
    builder = match request.provider {
        Provider::Openai => builder.bearer_auth(request.api_key.trim()),
        Provider::Anthropic => builder
            .header("x-api-key", request.api_key.trim())
            .header("anthropic-version", "2023-06-01"),
    };

    let response = tokio::select! {
        changed = cancelled.changed() => {
            let _ = changed;
            return Err("请求已取消".to_string());
        }
        result = builder.send() => result.map_err(|_| "无法连接模型服务".to_string())?,
    };

    if response.status().is_redirection() {
        return Err("API 地址发生了不安全的跳转".to_string());
    }
    if !response.status().is_success() {
        let bytes = read_limited_body(response, 4_096).await?;
        return Err(safe_upstream_error(&bytes, request.api_key.trim()));
    }

    let is_sse = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if !is_sse {
        let bytes = read_limited_body(response, MAX_OUTPUT_BYTES).await?;
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "模型服务返回了无法识别的内容".to_string())?;
        let text = extract_non_streaming_text(request.provider, &payload);
        if text.is_empty() {
            return Err("模型服务返回了空内容".to_string());
        }
        channel
            .send(AiEvent::Delta { text })
            .map_err(|_| "无法向编辑器传递模型响应".to_string())?;
        channel
            .send(AiEvent::Done)
            .map_err(|_| "无法完成模型响应".to_string())?;
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut pending = Vec::<u8>::new();
    let mut event_data = Vec::<String>::new();
    let mut received = 0usize;
    let mut completed = false;

    while !completed {
        let next = tokio::select! {
            changed = cancelled.changed() => {
                let _ = changed;
                return Err("请求已取消".to_string());
            }
            chunk = stream.next() => chunk,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|_| "模型流式响应意外中断".to_string())?;
        received = received.saturating_add(chunk.len());
        if received > MAX_OUTPUT_BYTES {
            return Err("模型输出超过 8 MB 限制".to_string());
        }
        pending.extend_from_slice(&chunk);

        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let mut line = pending.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = std::str::from_utf8(&line)
                .map_err(|_| "模型返回了无效的 UTF-8 数据".to_string())?;
            if line.is_empty() {
                if event_data.is_empty() {
                    continue;
                }
                let data = event_data.join("\n");
                event_data.clear();
                let (text, done) = parse_sse_data(request.provider, &data)?;
                if !text.is_empty() {
                    channel
                        .send(AiEvent::Delta { text })
                        .map_err(|_| "无法向编辑器传递模型响应".to_string())?;
                }
                completed |= done;
            } else if let Some(data) = line.strip_prefix("data:") {
                event_data.push(data.trim_start().to_string());
            }
        }
    }

    if !completed {
        if !pending.is_empty() {
            let line = std::str::from_utf8(&pending)
                .map_err(|_| "模型返回了无效的 UTF-8 数据".to_string())?;
            if let Some(data) = line.trim_end_matches('\r').strip_prefix("data:") {
                event_data.push(data.trim_start().to_string());
            }
        }
        if !event_data.is_empty() {
            let (text, done) = parse_sse_data(request.provider, &event_data.join("\n"))?;
            if !text.is_empty() {
                channel
                    .send(AiEvent::Delta { text })
                    .map_err(|_| "无法向编辑器传递模型响应".to_string())?;
            }
            completed |= done;
        }
    }

    if !completed {
        return Err("模型响应提前结束，请重试".to_string());
    }
    channel
        .send(AiEvent::Done)
        .map_err(|_| "无法完成模型响应".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn stream_ai(
    request: AiRequest,
    on_event: Channel<AiEvent>,
    state: State<'_, AiState>,
) -> Result<(), String> {
    let (sender, receiver) = watch::channel(false);
    {
        let mut cancellations = state.cancellations.lock().expect("AI cancellation lock");
        if cancellations.contains_key(&request.request_id) {
            return Err("请求标识重复".to_string());
        }
        cancellations.insert(request.request_id.clone(), sender);
    }

    let request_id = request.request_id.clone();
    let result = execute_stream(&request, &on_event, receiver)
        .await
        .map_err(|message| message.replace(request.api_key.trim(), "[已隐藏]"));
    state
        .cancellations
        .lock()
        .expect("AI cancellation lock")
        .remove(&request_id);
    if let Err(message) = &result {
        if message != "请求已取消" {
            let _ = on_event.send(AiEvent::Error {
                message: message.clone(),
            });
        }
    }
    result
}

#[tauri::command]
pub fn cancel_ai(request_id: String, state: State<'_, AiState>) -> bool {
    state
        .cancellations
        .lock()
        .expect("AI cancellation lock")
        .get(&request_id)
        .is_some_and(|sender| sender.send(true).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_provider_endpoints_without_doubling_suffixes() {
        let openai =
            resolve_endpoint(Provider::Openai, "https://api.openai.com/v1").expect("OpenAI URL");
        assert_eq!(
            openai.as_str(),
            "https://api.openai.com/v1/chat/completions"
        );
        let anthropic =
            resolve_endpoint(Provider::Anthropic, "https://api.anthropic.com/v1/messages")
                .expect("Anthropic URL");
        assert_eq!(anthropic.as_str(), "https://api.anthropic.com/v1/messages");

        let custom_port = resolve_endpoint(Provider::Openai, "https://gateway.example.com:8443/v1")
            .expect("custom HTTPS port URL");
        assert_eq!(
            custom_port.as_str(),
            "https://gateway.example.com:8443/v1/chat/completions"
        );

        let loopback = resolve_endpoint(Provider::Openai, "http://127.0.0.1:11434/v1")
            .expect("loopback IPv4 URL");
        assert_eq!(
            loopback.as_str(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        let lan = resolve_endpoint(Provider::Anthropic, "http://192.168.1.20:8080/v1")
            .expect("LAN IPv4 URL");
        assert_eq!(lan.as_str(), "http://192.168.1.20:8080/v1/messages");
        let ipv6 =
            resolve_endpoint(Provider::Openai, "http://[::1]:11434/v1").expect("loopback IPv6 URL");
        assert_eq!(ipv6.as_str(), "http://[::1]:11434/v1/chat/completions");
    }

    #[test]
    fn rejects_public_plaintext_ip_and_unsafe_url_parts() {
        assert!(resolve_endpoint(Provider::Openai, "http://8.8.8.8/v1").is_err());
        assert!(resolve_endpoint(Provider::Openai, "https://key@example.com/v1").is_err());
        assert!(resolve_endpoint(Provider::Openai, "https://example.com/v1?q=1").is_err());
    }

    #[test]
    fn enforces_resolved_address_policy_for_http_and_https() {
        let local_addresses = [
            "127.0.0.1:11434".parse().expect("IPv4 loopback"),
            "[::1]:11434".parse().expect("IPv6 loopback"),
            "192.168.1.20:11434".parse().expect("LAN IPv4"),
        ];
        let public_address = ["8.8.8.8:443".parse().expect("public IPv4")];
        assert!(validate_address_policy("http", &local_addresses).is_ok());
        assert!(validate_address_policy("http", &public_address).is_err());
        assert!(validate_address_policy("https", &local_addresses).is_ok());
        assert!(validate_address_policy("https", &public_address).is_ok());
    }

    #[test]
    fn parses_openai_and_anthropic_stream_events() {
        let (text, done) = parse_sse_data(
            Provider::Openai,
            r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#,
        )
        .expect("OpenAI event");
        assert_eq!(text, "Hello");
        assert!(!done);
        let (text, done) = parse_sse_data(
            Provider::Anthropic,
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Map"}}"#,
        )
        .expect("Anthropic event");
        assert_eq!(text, "Map");
        assert!(!done);
        assert!(
            parse_sse_data(Provider::Openai, "[DONE]")
                .expect("done event")
                .1
        );
    }

    #[test]
    fn channel_events_match_the_typescript_contract() {
        let delta = serde_json::to_value(AiEvent::Delta {
            text: "hello".into(),
        })
        .expect("serialize delta");
        assert_eq!(delta, json!({ "type": "delta", "text": "hello" }));
        let error = serde_json::to_value(AiEvent::Error {
            message: "failed".into(),
        })
        .expect("serialize error");
        assert_eq!(error, json!({ "type": "error", "message": "failed" }));
        assert_eq!(
            serde_json::to_value(AiEvent::Done).expect("serialize done"),
            json!({ "type": "done" })
        );
    }
}
