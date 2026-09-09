fn validate_external_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "链接地址无效".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return Err("仅支持 HTTP、HTTPS 和邮件链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .status()
            .map_err(|error| format!("无法打开链接: {error}"))?;
        if !status.success() {
            return Err("系统未能打开链接".into());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Pass the URL directly to the OS, without a command shell.
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        let target: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result <= 32 {
            return Err("系统未能打开链接".into());
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = url;
        Err("当前平台暂不支持打开外部链接".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_and_mail_links_are_allowed() {
        for value in [
            "https://example.com/a?q=1#title",
            "http://localhost:8080",
            "mailto:hello@example.com",
        ] {
            assert!(validate_external_url(value).is_ok());
        }
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,test",
            "relative.md",
            "shell:AppsFolder",
        ] {
            assert!(validate_external_url(value).is_err());
        }
    }
}
