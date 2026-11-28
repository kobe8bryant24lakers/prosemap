use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::collections::{BTreeMap, BTreeSet};
use std::net::IpAddr;
use std::time::{Duration, Instant};

const SERVICE: &str = "_prosemap._tcp.local.";

fn lan_origin(address: IpAddr, port: u16, scheme: &str) -> Option<String> {
    if port == 0 || !matches!(scheme, "https" | "http") {
        return None;
    }
    match address {
        IpAddr::V4(ip) if ip.is_private() || ip.is_link_local() => {
            Some(format!("{scheme}://{ip}:{port}"))
        }
        IpAddr::V6(ip) if ip.octets()[0] & 0xfe == 0xfc => {
            Some(format!("{scheme}://[{ip}]:{port}"))
        }
        _ => None,
    }
}

fn browse() -> Result<Vec<String>, String> {
    let daemon = ServiceDaemon::new().map_err(|_| "LAN discovery unavailable")?;
    let result = (|| {
        let events = daemon
            .browse(SERVICE)
            .map_err(|_| "LAN discovery unavailable")?;
        let deadline = Instant::now() + Duration::from_millis(2400);
        let mut services = BTreeMap::new();
        while Instant::now() < deadline {
            let Ok(event) = events.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            else {
                break;
            };
            match event {
                ServiceEvent::ServiceResolved(info)
                    if info.ty_domain == SERVICE
                        && info.get_property_val_str("version") == Some("1") =>
                {
                    let scheme = info.get_property_val_str("scheme").unwrap_or_default();
                    let origins: Vec<_> = info
                        .get_addresses()
                        .iter()
                        .filter_map(|ip| lan_origin(ip.to_ip_addr(), info.get_port(), scheme))
                        .take(8)
                        .collect();
                    services.insert(info.fullname, origins);
                    if services.len() >= 32 {
                        break;
                    }
                }
                ServiceEvent::ServiceRemoved(_, name) => {
                    services.remove(&name);
                }
                _ => {}
            }
        }
        let unique: BTreeSet<_> = services.into_values().flatten().collect();
        Ok(unique.into_iter().take(32).collect())
    })();
    let _ = daemon.shutdown();
    result
}

#[tauri::command]
pub async fn discover_collaboration_services() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(browse)
        .await
        .map_err(|_| "LAN discovery unavailable")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_uses_only_private_service_addresses() {
        assert_eq!(
            lan_origin("192.168.1.10".parse().unwrap(), 8787, "https").as_deref(),
            Some("https://192.168.1.10:8787")
        );
        assert_eq!(
            lan_origin("fd00::1".parse().unwrap(), 443, "https").as_deref(),
            Some("https://[fd00::1]:443")
        );
        for ip in ["127.0.0.1", "0.0.0.0", "203.0.113.8", "::1", "ff02::1"] {
            assert!(lan_origin(ip.parse().unwrap(), 8787, "http").is_none());
        }
        assert!(lan_origin("10.0.0.1".parse().unwrap(), 0, "http").is_none());
        assert!(lan_origin("10.0.0.1".parse().unwrap(), 80, "file").is_none());
    }
}
