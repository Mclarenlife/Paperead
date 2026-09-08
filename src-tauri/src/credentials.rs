#[tauri::command]
pub fn credentials_supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos", target_os = "ios", target_os = "android"))
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "ios"))]
fn access(account: String, action: u8, secret: String) -> Result<Option<String>, String> {
    // Serialize native store access, and restrict all operations to our own service.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _lock = LOCK.lock().map_err(|_| "系统凭据存储正忙，请重试。")?;
    if account.len() != 64 || !account.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("凭据标识无效。".into());
    }
    let entry = keyring::Entry::new("app.paperead.reader.ai", &account)
        .map_err(|_| "无法访问系统凭据存储。".to_string())?;
    match action {
        1 => {
            if secret.is_empty() || secret.len() > 2400 { return Err("API Key 长度无效。".into()); }
            entry.set_password(&secret).map_err(|_| "系统未能保存 API Key，请检查系统凭据权限。".to_string())?;
            Ok(None)
        }
        2 => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("系统未能删除 API Key。".into()),
        },
        _ => match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取已保存的 API Key，请检查系统凭据权限。".into()),
        },
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
fn access(_account: String, _action: u8, _secret: String) -> Result<Option<String>, String> {
    Err("此平台暂不支持系统凭据存储，请使用会话密钥。".into())
}

#[tauri::command]
pub async fn read_credential(app: tauri::AppHandle, account: String) -> Result<Option<String>, String> {
    access_async(app, account, 0, String::new()).await
}
#[tauri::command]
pub async fn write_credential(app: tauri::AppHandle, account: String, secret: String) -> Result<(), String> {
    access_async(app, account, 1, secret).await?;
    Ok(())
}
#[tauri::command]
pub async fn delete_credential(app: tauri::AppHandle, account: String) -> Result<(), String> {
    access_async(app, account, 2, String::new()).await?;
    Ok(())
}

async fn access_async(app: tauri::AppHandle, account: String, action: u8, secret: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    { tauri_plugin_paperead_credentials::access(&app, account, action, secret).await }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || access(account, action, secret))
            .await.map_err(|_| "凭据访问任务中断。".to_string())?
    }
}
