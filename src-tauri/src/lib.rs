mod ai;
mod endpoint;
mod files;
mod secure_config;

use ai::AiState;
use files::{launch_target_from_args, launch_target_from_path, FileAccessState};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        let target = urls
            .iter()
            .filter_map(|url| url.to_file_path().ok())
            .find_map(|path| launch_target_from_path(&path).ok());
        if let Some(target) = target {
            app_handle
                .state::<FileAccessState>()
                .set_launch_target(target.clone());
            let _ = app_handle.emit("local-opened", target);
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_run_event(_app_handle: &tauri::AppHandle, _event: tauri::RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_target = launch_target_from_args();
    let app = tauri::Builder::default()
        .manage(AiState::default())
        .manage(FileAccessState::with_pending(initial_target))
        .invoke_handler(tauri::generate_handler![
            ai::stream_ai,
            ai::cancel_ai,
            files::pick_markdown_file,
            files::pick_markdown_folder,
            files::pick_ai_context_files,
            files::read_local_markdown,
            files::save_local_markdown,
            files::read_launch_target,
            secure_config::save_model_config,
            secure_config::load_model_config,
        ])
        .build(tauri::generate_context!())
        .expect("无法初始化 ProseMap 桌面端");

    app.run(handle_run_event);
}
