use super::error::{CommandError, CommandResult, ErrorKind};

pub async fn run_blocking<T, F>(work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| {
            CommandError::new(ErrorKind::Io, format!("tarefa interrompida: {error}"))
        })?
}
