use crate::endpoint::{is_local_network_ip, is_unusable_destination, parse_base_url};
use futures_util::StreamExt;
use reqwest::{header, redirect::Policy, Client, Response, StatusCode, Url};
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
const MAX_ERROR_CHARS: usize = 700;

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
                .map_err(|error| format!("无法解析 API 主机名 {host}：{error}"))?
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

fn redact_and_limit(message: &str, api_key: &str) -> String {
    let redacted = if api_key.is_empty() {
        message.to_string()
    } else {
        message.replace(api_key, "[已隐藏]")
    };
    redacted.chars().take(MAX_ERROR_CHARS).collect()
}

fn upstream_error_detail(bytes: &[u8]) -> Option<String> {
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .or_else(|| value.get("detail").and_then(Value::as_str))
                .or_else(|| value.get("error").and_then(Value::as_str))
                .or_else(|| value.pointer("/error/code").and_then(Value::as_str))
                .map(str::to_string)
        })
        .filter(|message| !message.trim().is_empty())
}

fn upstream_error_message(
    status: StatusCode,
    endpoint: &Url,
    bytes: &[u8],
    api_key: &str,
) -> String {
    let summary = match status {
        StatusCode::BAD_REQUEST => "请求格式或参数不受模型服务支持",
        StatusCode::UNAUTHORIZED => "API 密钥无效或未获得授权",
        StatusCode::PAYMENT_REQUIRED => "模型账户余额或付费状态异常",
        StatusCode::FORBIDDEN => "模型服务拒绝访问当前模型或资源",
        StatusCode::NOT_FOUND => "API 路径或模型不存在",
        StatusCode::METHOD_NOT_ALLOWED => "API 路径不接受当前请求方法",
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => "模型服务处理请求超时",
        StatusCode::CONFLICT => "模型服务拒绝了冲突的请求",
        StatusCode::UNPROCESSABLE_ENTITY => "模型服务无法处理请求参数",
        StatusCode::TOO_MANY_REQUESTS => "请求过于频繁、额度不足或已达到限额",
        status if status.is_server_error() => "上游模型服务暂时不可用",
        _ => "上游模型服务拒绝了本次请求",
    };
    let mut message = format!(
        "{summary}（HTTP {}）。请求地址：{}",
        status.as_u16(),
        endpoint
    );
    if let Some(detail) = upstream_error_detail(bytes) {
        message.push_str("。服务返回：");
        message.push_str(detail.trim());
    }
    redact_and_limit(&message, api_key)
}

fn request_error_sources(error: &reqwest::Error) -> Vec<String> {
    let mut messages = Vec::new();
    let mut source = std::error::Error::source(error);
    while let Some(reason) = source {
        messages.push(reason.to_string());
        source = reason.source();
    }
    messages
}

fn transport_source_summary(details: &str) -> Option<&'static str> {
    let details = details.to_ascii_lowercase();
    if details.contains("certificate")
        || details.contains("unknownissuer")
        || details.contains("unknown issuer")
        || details.contains("invalid peer")
        || details.contains("tls")
        || details.contains("ssl")
    {
        return Some("TLS 握手或证书校验失败，请检查服务证书链或企业代理证书");
    }
    if details.contains("connection refused")
        || details.contains("actively refused")
        || details.contains("os error 61")
        || details.contains("os error 111")
        || details.contains("os error 10061")
    {
        return Some("模型服务拒绝连接，请确认服务已启动且 API 端口正确");
    }
    if details.contains("network is unreachable")
        || details.contains("no route to host")
        || details.contains("os error 51")
        || details.contains("os error 101")
        || details.contains("os error 10051")
    {
        return Some("模型服务所在网络不可达，请检查网络、VPN 或代理");
    }
    if details.contains("dns")
        || details.contains("name resolution")
        || details.contains("failed to lookup address")
        || details.contains("nodename nor servname")
    {
        return Some("模型服务域名解析失败，请检查 API 地址或 DNS");
    }
    if details.contains("proxy") || details.contains("tunnel") {
        return Some("代理连接失败，请检查代理地址、认证与放行规则");
    }
    if details.contains("connection reset")
        || details.contains("broken pipe")
        || details.contains("unexpected eof")
    {
        return Some("连接被模型服务或中间代理意外断开");
    }
    None
}

fn transport_failure_summary(error: &reqwest::Error, details: &str) -> &'static str {
    if error.is_timeout() {
        if error.is_connect() {
            return "连接模型服务超时，请检查 API 地址、网络、VPN 或代理";
        }
        return "等待模型服务响应超时，请稍后重试或缩小处理内容";
    }
    if let Some(summary) = transport_source_summary(details) {
        return summary;
    }
    if error.is_connect() {
        return "无法与模型服务建立 TCP 连接，请检查地址、端口、网络或代理";
    }
    if error.is_builder() {
        return "模型请求构造失败，请检查 API 地址与请求配置";
    }
    if error.is_body() {
        return "模型请求或响应数据传输失败";
    }
    if error.is_decode() {
        return "模型响应解码失败";
    }
    "发送模型请求失败"
}

fn safe_root_cause(sources: &[String], api_key: &str) -> Option<String> {
    let source = sources
        .last()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if source.is_empty()
        || source.contains("://")
        || source.contains('@')
        || source.to_ascii_lowercase().contains("authorization")
    {
        return None;
    }
    Some(
        redact_and_limit(&source, api_key)
            .chars()
            .take(220)
            .collect(),
    )
}

fn request_error_message(error: &reqwest::Error, endpoint: &Url, api_key: &str) -> String {
    let sources = request_error_sources(error);
    let details = sources.join("; ");
    let summary = transport_failure_summary(error, &details);
    let mut message = format!("{summary}。请求地址：{endpoint}");
    if let Some(cause) = safe_root_cause(&sources, api_key) {
        message.push_str("。底层原因：");
        message.push_str(&cause);
    }
    redact_and_limit(&message, api_key)
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

async fn read_limited_body(
    response: Response,
    limit: usize,
    endpoint: &Url,
    api_key: &str,
) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| request_error_message(&error, endpoint, api_key))?;
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
    let (endpoint_domain, resolved_addresses) = resolve_addresses(&endpoint)
        .await
        .map_err(|message| format!("{message}。请求地址：{endpoint}"))?;

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
        .map_err(|error| request_error_message(&error, &endpoint, request.api_key.trim()))?;

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
        .post(endpoint.clone())
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
        result = builder.send() => result.map_err(|error| {
            request_error_message(&error, &endpoint, request.api_key.trim())
        })?,
    };

    if response.status().is_redirection() {
        return Err(format!(
            "API 地址返回了重定向（HTTP {}）；为保护密钥，应用不会自动跟随。请填写最终 API 地址。请求地址：{}",
            response.status().as_u16(),
            endpoint
        ));
    }
    if !response.status().is_success() {
        let status = response.status();
        let bytes = read_limited_body(response, 4_096, &endpoint, request.api_key.trim()).await?;
        return Err(upstream_error_message(
            status,
            &endpoint,
            &bytes,
            request.api_key.trim(),
        ));
    }

    let response_content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("未提供")
        .to_string();
    let is_sse = response_content_type
        .to_ascii_lowercase()
        .contains("text/event-stream");
    if !is_sse {
        let bytes = read_limited_body(
            response,
            MAX_OUTPUT_BYTES,
            &endpoint,
            request.api_key.trim(),
        )
        .await?;
        let payload: Value = serde_json::from_slice(&bytes).map_err(|_| {
            format!(
                "模型服务返回了无法识别的内容（Content-Type: {response_content_type}）。请检查 API 地址与服务类型。请求地址：{endpoint}"
            )
        })?;
        let text = extract_non_streaming_text(request.provider, &payload);
        if text.is_empty() {
            return Err(format!(
                "模型服务返回了空内容或不兼容的响应格式。请检查服务类型与模型接口。请求地址：{endpoint}"
            ));
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
        let chunk = chunk.map_err(|error| {
            format!(
                "模型流式响应意外中断。{}",
                request_error_message(&error, &endpoint, request.api_key.trim())
            )
        })?;
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
        .map_err(|message| redact_and_limit(&message, request.api_key.trim()));
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
    fn reports_http_status_endpoint_and_safe_upstream_detail() {
        let endpoint =
            Url::parse("https://api.example.com/v1/chat/completions").expect("valid endpoint");
        let message = upstream_error_message(
            StatusCode::UNAUTHORIZED,
            &endpoint,
            br#"{"error":{"message":"invalid token secret-key"}}"#,
            "secret-key",
        );
        assert!(message.contains("API 密钥无效或未获得授权"));
        assert!(message.contains("HTTP 401"));
        assert!(message.contains(endpoint.as_str()));
        assert!(message.contains("invalid token [已隐藏]"));
        assert!(!message.contains("secret-key"));

        let unavailable = upstream_error_message(
            StatusCode::BAD_GATEWAY,
            &endpoint,
            b"<html>bad gateway</html>",
            "",
        );
        assert!(unavailable.contains("上游模型服务暂时不可用"));
        assert!(unavailable.contains("HTTP 502"));
        assert!(!unavailable.contains("<html>"));
    }

    #[test]
    fn classifies_common_transport_failures() {
        let cases = [
            (
                "invalid peer certificate: UnknownIssuer",
                "TLS 握手或证书校验失败",
            ),
            (
                "tcp connect error: Connection refused (os error 61)",
                "模型服务拒绝连接",
            ),
            ("No route to host (os error 65)", "模型服务所在网络不可达"),
            (
                "dns error: failed to lookup address",
                "模型服务域名解析失败",
            ),
            ("proxy tunnel error", "代理连接失败"),
            (
                "connection reset by peer",
                "连接被模型服务或中间代理意外断开",
            ),
        ];
        for (detail, expected) in cases {
            assert!(
                transport_source_summary(detail)
                    .expect("classified transport error")
                    .contains(expected),
                "should classify {detail}"
            );
        }
        assert!(transport_source_summary("an uncommon transport failure").is_none());
    }

    #[test]
    fn redaction_is_safe_for_empty_and_non_empty_keys() {
        assert_eq!(redact_and_limit("API 密钥无效", ""), "API 密钥无效");
        assert_eq!(
            redact_and_limit("request contained abc123", "abc123"),
            "request contained [已隐藏]"
        );
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
