#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod build_queue;
mod commands;
mod docker_exec;
mod env_checker;
mod project_store;
mod types;
mod offline_pack;

use commands::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            use tauri::Manager;
            // 启动即加载配置，保证环境检测/构建读取到同一份数据
            let cfg = project_store::load(app.handle()).unwrap_or_default();
            let state = app.state::<AppState>();
            *state.config.lock().unwrap() = cfg;
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
            commands::export_offline_pack,
            commands::import_offline_pack
        ])
        .run(tauri::generate_context!())
        .expect("error while running HR Docker Builder");
}
