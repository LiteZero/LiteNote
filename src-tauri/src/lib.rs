use std::time::Duration;

use chrono::{Datelike, TimeDelta, Timelike, Months, NaiveDate, DateTime};
use rusqlite::Connection;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, Manager, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, TitleBarStyle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// 提醒提前量（毫秒），默认 15 分钟
const REMIND_ADVANCE_MS: i64 = 15 * 60 * 1000;

/// 背景提醒轮询间隔
const REMINDER_POLL_INTERVAL_SECS: u64 = 30;

/// 循环待办：根据当前截止时间和规则计算下一次截止时间戳
fn compute_next_due(current_due_ms: i64, recurrence_type: &str, config: &str) -> Option<i64> {
    use std::collections::HashMap;

    if current_due_ms <= 0 || recurrence_type == "none" {
        return None;
    }

    let cfg: HashMap<String, serde_json::Value> = serde_json::from_str(config).ok()?;
    let interval = cfg.get("interval").and_then(|v| v.as_i64()).unwrap_or(1).max(1);

    // 毫秒 → NaiveDateTime
    let dt = match DateTime::from_timestamp(current_due_ms / 1000, 0) {
        Some(dt) => dt.naive_utc(),
        None => return None,
    };

    let next_dt = match recurrence_type {
        "daily" => {
            dt + TimeDelta::days(interval)
        }
        "weekly" => {
            let days: Vec<i64> = cfg.get("days")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_i64()).collect())
                .unwrap_or_default();

            if days.is_empty() {
                dt + TimeDelta::weeks(interval as i64)
            } else {
                let current_wday = dt.weekday().num_days_from_sunday() as i64;
                let mut sorted = days.clone();
                sorted.sort();

                let next_day = sorted.iter().find(|&&d| d > current_wday);
                let offset_days = match next_day {
                    Some(&nd) => nd - current_wday,
                    None => {
                        let weeks_offset = (interval - 1) * 7;
                        (7 - current_wday) + sorted[0] + weeks_offset
                    }
                };
                dt + TimeDelta::days(offset_days)
            }
        }
        "monthly" => {
            let day_of_month = cfg.get("dayOfMonth")
                .and_then(|v| v.as_i64())
                .unwrap_or(dt.day() as i64) as u32;

            // 每次过期都推进 interval 个月（不判断 day 大小，因为函数只在过期时调用）
            let mut y = dt.date().year();
            let mut m = dt.date().month() as i32 + interval as i32;
            while m > 12 {
                m -= 12;
                y += 1;
            }

            // 目标月最大天数
            let max_day = NaiveDate::from_ymd_opt(y, m as u32, 1)
                .and_then(|d| d.checked_add_months(Months::new(1)))
                .and_then(|d| d.pred_opt())
                .map(|d| d.day())
                .unwrap_or(31);

            let target_day = day_of_month.min(max_day);
            let target_date = NaiveDate::from_ymd_opt(y, m as u32, target_day)?;

            target_date
                .and_hms_opt(dt.hour(), dt.minute(), dt.second())?
        }
        _ => return None,
    };

    Some(next_dt.and_utc().timestamp_millis())
}


/// 检查并自动推进循环待办（过期时间滚动到下一轮）
fn advance_recurring_todos(conn: &Connection, now_ms: i64) {
    // 先用块作用域收集结果以释放 conn 借用
    let rows: Vec<(String, i64, String, String)> = {
        let mut stmt = match conn.prepare(
            "SELECT id, due_date, recurrence_type, recurrence_config FROM todos WHERE is_recurring = 1 AND due_date > 0 AND due_date < ?1",
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[LiteNote] 循环推进查询失败: {e}");
                return;
            }
        };

        let mapped = match stmt.query_map(rusqlite::params![now_ms], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        }) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[LiteNote] 循环推进查询失败: {e}");
                return;
            }
        };

        mapped.filter_map(|r| r.ok()).collect()
    }; // stmt 在此释放，conn 借用结束

    for (id, due_date, rec_type, rec_config) in &rows {
        if let Some(next_due) = compute_next_due(*due_date, rec_type, rec_config) {
            if let Err(e) = conn.execute(
                "UPDATE todos SET due_date = ?2, reminded = 0, update_time = ?3 WHERE id = ?1",
                rusqlite::params![id, next_due, now_ms],
            ) {
                eprintln!("[LiteNote] 循环推进更新失败 (id={}): {e}", id);
            } else {
                println!(
                    "[LiteNote] 循环待办 {} 自动推进: {} -> {}",
                    id, due_date, next_due
                );
            }
        }
    }
}

/// 与前端 `tauri-plugin-sql` 一致：数据库位于 app_config_dir/litenote.db
fn litenote_db_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("litenote.db"))
}

fn todos_table_exists(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='todos' LIMIT 1",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

/// 待办行的最小字段集合（Rust 端开窗所需）
struct ReminderRow {
    id: String,
    text: String,
    due_date: i64,
}

/// 查询到当前应当弹出提醒的待办
/// - 命中条件：due_date > 0 且 due_date - REMIND_ADVANCE_MS <= now 且 reminded = 0
fn query_due_reminders(conn: &Connection, now: i64) -> Vec<ReminderRow> {
    let threshold = now + REMIND_ADVANCE_MS;

    let mut stmt = match conn.prepare(
        "SELECT id, text, due_date \
         FROM todos \
         WHERE due_date > 0 \
           AND due_date - ?1 <= ?2 \
           AND reminded = 0",
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[LiteNote] 提醒查询 SQL 准备失败: {e}");
            return Vec::new();
        }
    };

    let rows = match stmt.query_map(
        rusqlite::params![REMIND_ADVANCE_MS, threshold],
        |row| {
            Ok(ReminderRow {
                id: row.get(0)?,
                text: row.get(1)?,
                due_date: row.get(2)?,
            })
        },
    ) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[LiteNote] 提醒查询失败: {e}");
            return Vec::new();
        }
    };

    rows.filter_map(|r| r.ok()).collect()
}

/// 标记某条待办「本轮已提醒」，避免同一周期内重复弹
fn mark_reminded(conn: &Connection, id: &str) {
    if let Err(e) = conn.execute(
        "UPDATE todos SET reminded = 1 WHERE id = ?1",
        rusqlite::params![id],
    ) {
        eprintln!("[LiteNote] 标记已提醒失败 (id={}): {e}", id);
    }
}

/// 计算窗口显示位置：屏幕右上角（钉钉式），距离右边 16px、顶部 60px
///
/// 拿不到 monitor 信息时退回到左上 (60, 60)。
fn compute_reminder_position<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    // 默认右上角，跨平台安全值
    let win_w = 380.0_f64;
    let margin_right = 16.0_f64;
    let margin_top = 60.0_f64;

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let lw = size.width as f64 / scale;
        // 屏幕宽减去弹窗宽再减右边距；不低于 0
        let x = (lw - win_w - margin_right).max(0.0);
        return (x, margin_top);
    }
    (60.0, 60.0)
}

/// 格式化通知正文：`待办内容 —— 还有 X 分钟到期`
fn format_due_text(text: &str, due_date_ms: i64, now_ms: i64) -> String {
    if due_date_ms <= 0 {
        return text.to_string();
    }
    let diff_ms = due_date_ms - now_ms;
    let abs_ms = diff_ms.abs();
    let total_min = abs_ms / 60_000;

    let time_part = if abs_ms < 30_000 {
        "已到截止时间".to_string()
    } else if diff_ms > 0 {
        if total_min < 60 {
            format!("还有 {} 分钟到期", total_min)
        } else {
            let h = total_min / 60;
            let m = total_min % 60;
            if m == 0 {
                format!("还有 {} 小时到期", h)
            } else {
                format!("还有 {} 小时 {} 分钟到期", h, m)
            }
        }
    } else {
        if total_min < 60 {
            format!("已逾期 {} 分钟", total_min)
        } else {
            let h = total_min / 60;
            let m = total_min % 60;
            if m == 0 {
                format!("已逾期 {} 小时", h)
            } else {
                format!("已逾期 {} 小时 {} 分钟", h, m)
            }
        }
    };
    format!("{} —— {}", text, time_part)
}

/// 从 settings 表读取 reminderMode 配置，默认 "popup"
fn read_reminder_mode(conn: &Connection) -> String {
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_table {
        return "popup".to_string();
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'reminderMode'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "popup".to_string())
}

/// 创建并展示一条独立提醒弹窗（置顶 / 不可被主窗口遮挡）
fn show_reminder_window<R: Runtime>(app: &AppHandle<R>, row: &ReminderRow) {
    let label = format!("reminder-{}", row.id);

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        return;
    }

    let text_param = urlencoding_simple(&row.text);
    let url = format!(
        "index.html?window=reminder&todoId={}&text={}&dueDate={}",
        urlencoding_simple(&row.id),
        text_param,
        row.due_date,
    );

    let (x, y) = compute_reminder_position(app);

    // 先以不可见方式创建，避免 build() 时窗口管理器将其放到屏幕中央
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("提醒")
        .inner_size(380.0, 160.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)            // 配合 WebView 透明背景，彻底去掉 1px 边
        .shadow(false)                // 卡片自带 box-shadow，不需要窗口级阴影
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)               // 关键：首次弹出也不抢焦点，让用户主动点
        .visible(false);              // 先不可见，设好位置后再显示

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(TitleBarStyle::Transparent)
            .hidden_title(true);
    }

    let result = builder.build();

    match result {
        Ok(win) => {
            // 设好位置再显示，确保窗口出现在正确位置（屏幕右上角）
            let _ = win.set_position(LogicalPosition::new(x, y));

            // 针对不同系统进行「不抢焦点」的显示
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Ok(hwnd) = win.hwnd() {
                    unsafe {
                        // SW_SHOWNOACTIVATE = 4 : 显示但不激活
                        extern "system" {
                            fn ShowWindow(hwnd: isize, nCmdShow: i32) -> i32;
                        }
                        ShowWindow(hwnd.0, 4);
                    }
                } else {
                    let _ = win.show();
                }
            }

            #[cfg(target_os = "macos")]
            {
                // macOS 上 .show() 配合 focused(false) 通常不抢焦点
                let _ = win.show();
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                let _ = win.show();
            }

            println!("[LiteNote] 提醒弹窗已创建: label={}", label);
        }
        Err(e) => {
            eprintln!("[LiteNote] 创建提醒弹窗失败: {e}");
        }
    }
}

/// 极简 URL 编码（不引外部 crate），仅处理中文 / 空格 / 特殊字符
fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// 检查并发送到期提醒（从 Rust 端直接操作 SQLite）
fn check_and_notify(app: &AppHandle, db_path: &std::path::Path) {
    if !db_path.exists() {
        return;
    }

    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[LiteNote] 提醒检查：无法打开数据库: {e}");
            return;
        }
    };

    if !todos_table_exists(&conn) {
        return;
    }

    // 读取用户设置的提醒方式
    let reminder_mode = read_reminder_mode(&conn);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // 1. 提醒检查
    let rows = query_due_reminders(&conn, now);
    if !rows.is_empty() {
        println!(
            "[LiteNote] 发现 {} 条待办需要提醒 (mode={})",
            rows.len(),
            reminder_mode
        );
        for row in &rows {
            match reminder_mode.as_str() {
                "system" => {
                    // 系统通知：使用 tauri-plugin-notification
                    let body = format_due_text(&row.text, row.due_date, now);
                    if let Err(e) = app
                        .notification()
                        .builder()
                        .title("LiteNote 提醒")
                        .body(&body)
                        .show()
                    {
                        eprintln!("[LiteNote] 发送系统通知失败: {e}");
                    } else {
                        println!(
                            "[LiteNote] 系统通知已发送: label={}",
                            row.id
                        );
                    }
                }
                _ => {
                    // 默认弹窗
                    show_reminder_window(app, row);
                }
            }
            mark_reminded(&conn, &row.id);
        }
    }

    // 1.5 兜底：把已经过期且没被循环推进处理掉的 todo 的 reminded 复位为 0
    // （防止旧 reminder=1 永久卡住，导致新逻辑永远不弹）
    let _ = conn.execute(
        "UPDATE todos SET reminded = 0 WHERE due_date > 0 AND due_date < ?1 AND is_recurring = 0 AND completed = 0",
        rusqlite::params![now],
    );

    // 2. 循环待办自动推进
    advance_recurring_todos(&conn, now);
}

// ──────────────── 前端调用的 Tauri Commands ────────────────

/// 提醒窗口中的用户操作
/// - action = "snooze": 延后 delayMinutes 分钟，关闭弹窗
/// - action = "close" : 仅关闭弹窗（「我知道了」/×，不修改数据）
#[tauri::command]
fn reminder_action(
    app: AppHandle,
    todo_id: String,
    action: String,
    delay_minutes: Option<i64>,
) -> Result<(), String> {
    // 找到 db 路径
    let db_path = litenote_db_path(&app).ok_or_else(|| "无法获取数据库路径".to_string())?;
    if !db_path.exists() {
        return Err("数据库文件不存在".into());
    }

    let conn = Connection::open(&db_path).map_err(|e| format!("打开 DB 失败: {e}"))?;

    match action.as_str() {
        "snooze" => {
            let delay = delay_minutes.unwrap_or(5).max(1);
            // 在原有截止时间基础上叠加，不是从「现在」计算
            let current_due: i64 = conn
                .query_row(
                    "SELECT due_date FROM todos WHERE id = ?1",
                    rusqlite::params![todo_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let new_due = if current_due > 0 {
                current_due + delay * 60_000
            } else {
                now_ms() + delay * 60_000
            };
            conn.execute(
                "UPDATE todos SET due_date = ?2, reminded = 0, update_time = ?3 WHERE id = ?1",
                rusqlite::params![todo_id, new_due, now_ms()],
            )
            .map_err(|e| format!("更新失败: {e}"))?;
        }
        "close" => {
            // 「我知道了」/× 关闭弹窗，标记本轮已提醒
            conn.execute(
                "UPDATE todos SET reminded = 1, update_time = ?2 WHERE id = ?1",
                rusqlite::params![todo_id, now_ms()],
            )
            .map_err(|e| format!("更新失败: {e}"))?;
        }
        other => {
            return Err(format!("未知 action: {other}"));
        }
    }

    // 让前端自己 close 窗口，Rust 不动（避免 macOS 唤起主窗口）
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// 启动 Rust 端后台提醒轮询（独立于前端，确保 macOS 上窗口隐藏时也能可靠提醒）
fn start_rust_reminder_poll(app: &AppHandle) {
    let handle = app.clone();

    // 获取数据库路径（与 plugin-sql 的 app_config_dir 保持一致）
    let db_path = match litenote_db_path(app) {
        Some(p) => p,
        None => {
            eprintln!("[LiteNote] 无法获取应用配置目录");
            return;
        }
    };

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
        .invoke_handler(tauri::generate_handler![reminder_action])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
