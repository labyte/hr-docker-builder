#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod build_queue;
mod commands;
mod docker_exec;
mod env_checker;
mod project_store;
mod types;
mod offline_pack;
mod shell;

use commands::AppState;

/// 启动时把窗口夹取到当前屏幕工作区内（小尺寸笔记本不溢出），有调整则居中
fn fit_window_to_workarea(app: &tauri::App) {
    use tauri::{LogicalSize, Manager};
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(Some(monitor)) = win.current_monitor() else { return };
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    let max_w = wa.size.width as f64 / scale * 0.94;
    let max_h = wa.size.height as f64 / scale * 0.94;
    if let Ok(size) = win.inner_size() {
        let cur_w = size.width as f64 / scale;
        let cur_h = size.height as f64 / scale;
        let (w, h) = (cur_w.min(max_w), cur_h.min(max_h));
        if (cur_w - w).abs() > 1.0 || (cur_h - h).abs() > 1.0 {
            let _ = win.set_size(LogicalSize::<f64>::new(w, h));
            let _ = win.center();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            use tauri::Manager;
            // 窗口标题追加版本号：运行时取 tauri.conf.json 的 version，升版本无需手动同步
            if let Some(win) = app.get_webview_window("main") {
                let base = app.config().product_name.as_deref().unwrap_or("HR Docker Builder");
                let _ = win.set_title(&format!("{base} v{}", app.package_info().version));
            }
            // 启动即加载配置，保证环境检测/构建读取到同一份数据
            let cfg = project_store::load(app.handle()).unwrap_or_default();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = cfg;
            fit_window_to_workarea(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::check_env,
            commands::ensure_builder,
            commands::install_qemu,
            commands::start_build,
            commands::cancel_build,
            commands::reveal_path,
            commands::get_export_dir,
            commands::export_offline_pack,
            commands::import_offline_pack
        ])
        .run(tauri::generate_context!())
        .expect("error while running HR Docker Builder");
}
