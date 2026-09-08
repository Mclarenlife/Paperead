use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, AppHandle, Manager, Runtime};
use serde::{Serialize, Deserialize};

struct Credentials<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("paperead-credentials")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.paperead.credentials", "CredentialsPlugin")?;
            app.manage(Credentials(handle));
            Ok(())
        }).build()
}
#[derive(Serialize)]
struct Request { account: String, action: u8, secret: String }
#[derive(Deserialize)]
struct Response { value: Option<String> }

pub async fn access<R: Runtime>(app: &AppHandle<R>, account: String, action: u8, secret: String) -> Result<Option<String>, String> {
    let result: Response = app.state::<Credentials<R>>().0.run_mobile_plugin_async("access", Request { account, action, secret }).await
        .map_err(|_| "无法访问 Android 安全凭据，请重新填写密钥或检查设备锁定状态。".to_string())?;
    Ok(result.value)
}
