// AttyMate Tauri shell entry point.
// The webview loads the React SPA built by `ui/`, which is configured at
// build time to call https://paperclip.attymate.com via VITE_PAPERCLIP_API_URL
// (see tauri.conf.json:beforeBuildCommand).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
