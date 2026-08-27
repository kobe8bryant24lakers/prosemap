use std::net::IpAddr;
use url::{Host, Url};

pub(crate) fn parse_base_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "API 地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("API 地址必须使用 HTTP 或 HTTPS".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含凭据、查询参数或锚点".to_string());
    }
    let host = url
        .host()
        .ok_or_else(|| "API 地址缺少有效的主机名或 IP".to_string())?;
    if matches!(host, Host::Domain(domain) if domain.trim_end_matches('.').is_empty()) {
        return Err("API 地址缺少有效的主机名或 IP".to_string());
    }
    if url.port() == Some(0) {
        return Err("API 地址端口必须在 1 到 65535 之间".to_string());
    }
    if url.scheme() == "http" {
        let literal_ip = match host {
            Host::Ipv4(ip) => Some(IpAddr::V4(ip)),
            Host::Ipv6(ip) => Some(IpAddr::V6(ip)),
            Host::Domain(_) => None,
        };
        if literal_ip.is_some_and(|ip| !is_local_network_ip(ip)) {
            return Err("HTTP API 地址仅允许本机、私有网络或链路本地 IP".to_string());
        }
    }
    Ok(url)
}

pub(crate) fn is_local_network_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4_mapped() {
                return is_local_network_ip(IpAddr::V4(ipv4));
            }
            let segments = ip.segments();
            ip.is_loopback() || (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

pub(crate) fn is_unusable_destination(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_broadcast()
                || octets[0] == 0
                || octets[0] >= 240
        }
        IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4_mapped() {
                return is_unusable_destination(IpAddr::V4(ipv4));
            }
            ip.is_unspecified() || ip.is_multicast()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_hostnames_and_ip_literals_with_optional_ports() {
        for endpoint in [
            "https://api.openai.com/v1",
            "https://gateway.example.com:8443/v1",
            "https://203.0.113.10/v1",
            "https://[2001:db8::10]:8443/v1",
            "http://127.0.0.1:11434/v1",
            "http://192.168.1.20:8080/v1",
            "http://[::1]:11434/v1",
            "http://[fe80::20]:8080/v1",
        ] {
            assert!(parse_base_url(endpoint).is_ok(), "should accept {endpoint}");
        }
    }

    #[test]
    fn rejects_public_http_ip_and_unsafe_url_parts() {
        for endpoint in [
            "http://8.8.8.8:8080/v1",
            "ftp://192.168.1.20/v1",
            "https://token@example.com/v1",
            "https://example.com/v1?key=value",
            "https://example.com/v1#fragment",
            "https://example.com:0/v1",
        ] {
            assert!(
                parse_base_url(endpoint).is_err(),
                "should reject {endpoint}"
            );
        }
    }

    #[test]
    fn classifies_local_and_unusable_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.2",
            "172.16.0.2",
            "192.168.0.2",
            "169.254.10.2",
            "100.64.0.2",
            "::1",
            "fd00::2",
            "fe80::2",
            "::ffff:192.168.0.2",
        ] {
            assert!(
                is_local_network_ip(address.parse().expect("valid IP")),
                "should classify {address} as local"
            );
        }
        for address in ["0.0.0.0", "224.0.0.1", "255.255.255.255", "::", "ff02::1"] {
            assert!(
                is_unusable_destination(address.parse().expect("valid IP")),
                "should classify {address} as unusable"
            );
        }
    }
}
