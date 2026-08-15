use super::runtime::{self, RuntimeStatus};

#[tauri::command]
pub async fn services_runtime_probe() -> RuntimeStatus {
    tauri::async_runtime::spawn_blocking(runtime::detect)
        .await
        .unwrap_or(RuntimeStatus::NotFound)
}
