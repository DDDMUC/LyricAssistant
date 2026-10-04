// Windows 下用 Manager 的 get_webview_window（macOS 用不到，别留 unused 警告）
#[cfg(target_os = "windows")]
use tauri::Manager;

/// 左键是否仍按着。
/// 原生窗口拖动只有 onMoved 事件，JS 读不到「松手」；磁吸靠它决定什么时候真收。
#[cfg(target_os = "macos")]
mod mouse {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }
    pub fn left_down() -> bool {
        // 0 = kCGEventSourceStateCombinedSessionState；0 = kCGMouseButtonLeft
        unsafe { CGEventSourceButtonState(0, 0) }
    }
}

#[cfg(target_os = "windows")]
mod mouse {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }
    pub fn left_down() -> bool {
        const VK_LBUTTON: i32 = 0x01;
        unsafe { (GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0 }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod mouse {
    pub fn left_down() -> bool {
        false
    }
}

#[tauri::command]
fn mouse_left_down() -> bool {
    mouse::left_down()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![mouse_left_down])
        .setup(|_app| {
            // Windows：去掉系统标题栏，改用页面内自绘标题栏（与 macOS 的 titleBarStyle Overlay 对齐）
            #[cfg(target_os = "windows")]
            {
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
