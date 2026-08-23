use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Runtime,
};

const PRODUCTION_HOST: &str = "moliu-markdown-studio.ko8e24lakers.chatgpt.site";

fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("navigation-guard")
        .on_navigation(|_, url| {
            let production = url.scheme() == "https"
                && url.host_str() == Some(PRODUCTION_HOST)
                && url.port_or_known_default() == Some(443);

            let development = cfg!(debug_assertions)
                && url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
                && url.port_or_known_default() == Some(3000);

            production || development
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        .run(tauri::generate_context!())
        .expect("启动墨流桌面端失败");
}
