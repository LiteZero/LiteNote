use std::time::Duration;

use rusqlite::Connection;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, TitleBarStyle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// 提醒提前量（毫秒），默认 15 分钟
const REMIND_ADVANCE_MS: i64 = 15 * 60 * 1000;

/// 背景提醒轮询间隔
const REMINDER_POLL_INTERVAL_SECS: u64 = 30;

/// 检查并发送到期提醒（从 Rust 端直接操作 SQLite）
fn check_and_notify(app: &AppHandle, db_path: &std::path::Path) {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[LiteNote] 提醒检查：无法打开数据库: {e}");
            return;
        }
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let threshold = now + REMIND_ADVANCE_MS;

    // 查询：截止时间 - 提前量 <= 当前时间，且尚未提醒
    // 用块作用域确保 stmt 在 conn.execute 之前释放
    let rows: Vec<(String, String)> = {
        let mut stmt = match conn.prepare(
            "SELECT id, text FROM todos WHERE due_date > 0 AND due_date - ?1 <= ?2 AND reminded = 0",
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[LiteNote] 提醒检查：SQL 准备失败: {e}");
                return;
            }
        };

        let mapped = match stmt.query_map(
            rusqlite::params![REMIND_ADVANCE_MS, threshold],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[LiteNote] 提醒检查：查询失败: {e}");
                return;
            }
        };

        let result: Vec<_> = mapped.filter_map(|r| r.ok()).collect();
        result
    }; // stmt 和 mapped 在此释放，conn 的借用结束

    if rows.is_empty() {
        return;
    }

    println!("[LiteNote] 发现 {} 条待办需要提醒", rows.len());

    for (id, text) in &rows {
        let body = if text.is_empty() {
            "(空)".to_string()
        } else if text.len() > 40 {
            format!("{}…", &text[..40])
        } else {
            text.clone()
        };

        // 发送系统通知
        if let Err(e) = app
            .notification()
            .builder()
            .title("轻签 · 待办提醒")
            .body(&body)
            .show()
        {
            eprintln!("[LiteNote] 发送通知失败: {e}");
            continue;
        }

        // 标记为已提醒
        if let Err(e) = conn.execute(
            "UPDATE todos SET reminded = 1 WHERE id = ?1",
            rusqlite::params![id],
        ) {
            eprintln!("[LiteNote] 标记已提醒失败 (id={}): {e}", id);
        }
    }
}

/// 启动 Rust 端后台提醒轮询（独立于前端，确保 macOS 上窗口隐藏时也能可靠提醒）
fn start_rust_reminder_poll(app: &AppHandle) {
    let handle = app.clone();

    // 获取数据库路径
    let db_dir = match app.path().app_local_data_dir() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[LiteNote] 无法获取应用数据目录: {e}");
            return;
        }
    };
    let db_path = db_dir.join("litenote.db");

    println!(
        "[LiteNote] 启动 Rust 端提醒轮询，数据库路径: {}",
        db_path.display()
    );

    tauri::async_runtime::spawn(async move {
        // 延迟 5 秒后首次检查，之后每 30 秒一次
        tokio::time::sleep(Duration::from_secs(5)).await;

        let mut interval =
            tokio::time::interval(Duration::from_secs(REMINDER_POLL_INTERVAL_SECS));
        // 跳过第一个即时 tick
        interval.tick().await;

        loop {
            interval.tick().await;
            let db_path = db_path.clone();
            let handle = handle.clone();

            // SQLite 是阻塞操作，放到 spawn_blocking 中执行
            let _ = tokio::task::spawn_blocking(move || {
                check_and_notify(&handle, &db_path);
            })
            .await;
        }
    });
}

fn tray_image<R: Runtime>(app: &AppHandle<R>) -> Image<'static> {
    if let Some(icon) = app.default_window_icon() {
        return Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height());
    }
    let mut rgba = Vec::with_capacity(32 * 32 * 4);
    for _ in 0..(32 * 32) {
        rgba.extend_from_slice(&[70u8, 140, 190, 255]);
    }
    Image::new_owned(rgba, 32, 32)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(visible) = w.is_visible() {
            if visible {
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let icon = tray_image(&handle);

            // macOS: 设置透明标题栏样式 + WebView 透明背景
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Transparent);

                    // 设置窗口背景色为透明
                    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
                }
            }

            let show_i =
                MenuItem::with_id(app, "tray_show", "显示窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("litenote-tray")
                .icon(icon)
                .tooltip("轻签 LiteNote")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "tray_quit" => {
                        app.exit(0);
                    }
                    "tray_show" => {
                        show_main_window(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            show_main_window(app);
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            show_main_window(app);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // 启动 Rust 端后台提醒轮询（独立于前端，macOS 窗口隐藏时也能可靠运行）
            start_rust_reminder_poll(app.handle());

            // 全局快捷键：CmdOrCtrl+Shift+L 切换显示/隐藏
            let shortcut_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+L",
                move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(&shortcut_handle);
                    }
                },
            )?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
