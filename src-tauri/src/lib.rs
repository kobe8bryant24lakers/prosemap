mod ai;
mod endpoint;
mod files;
mod links;
mod secure_config;

use ai::AiState;
use files::{launch_target_from_args, launch_target_from_path, FileAccessState};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

#[cfg(target_os = "macos")]
fn install_guarded_quit_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};

    // Cocoa's predefined Quit calls terminate: directly, bypassing Tauri's
    // interceptable window-close path. Keep the default menus, replacing only
    // that item with a regular menu event (including the standard shortcut).
    let menu = Menu::default(app)?;
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            for (index, item) in submenu.items()?.iter().enumerate() {
                if let MenuItemKind::Predefined(predefined) = item {
                    if predefined.text()? == quit_text {
                        submenu.remove_at(index)?;
                        submenu.insert(
                            &MenuItem::with_id(
                                app,
                                "guarded-quit",
                                "Quit ProseMap",
                                true,
                                Some("CmdOrCtrl+Q"),
                            )?,
                            index,
                        )?;
                    }
                }
            }
        }
    }
    app.set_menu(menu)?;
    Ok(())
}

fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    // Route runtime exit requests through the guarded window-close path.
    // Once the main window has closed, let the subsequent exit finish normally.
    if let tauri::RunEvent::ExitRequested {
        code: None, api, ..
    } = &event
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            api.prevent_exit();
            if let Err(error) = window.close() {
                eprintln!("无法请求关闭主窗口: {error}");
            }
        }
        return;
    }

    #[cfg(target_os = "macos")]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_target = launch_target_from_args();
    let app = tauri::Builder::default()
        .manage(AiState::default())
        .manage(FileAccessState::with_pending(initial_target))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            install_guarded_quit_menu(app.handle())?;
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "guarded-quit" {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.close() {
                        eprintln!("无法请求关闭主窗口: {error}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ai::stream_ai,
            links::open_external_url,
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
