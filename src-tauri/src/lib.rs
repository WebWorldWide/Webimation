mod bounce;
mod export;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Preset import/export goes through native dialogs; picked paths are scoped for fs access.
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_drag::init())
    .manage(export::Exports::default())
    .manage(bounce::Bounces::default())
    .invoke_handler(tauri::generate_handler![
      export::ffmpeg_status,
      export::export_begin,
      export::export_frame,
      export::export_finish,
      export::export_cancel,
      bounce::bounce,
      bounce::bounce_cancel,
      bounce::engine_info,
      bounce::write_text,
      bounce::write_file,
      bounce::default_out_dir
    ])
    .setup(|app| {
      let n = bounce::load_fonts(app.handle());
      log::info!("engine: {n} fonts loaded");
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
