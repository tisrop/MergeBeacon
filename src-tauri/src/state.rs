use crate::ai::config::AiConfigManager;
use crate::http_client::HttpClient;
use crate::vault::TokenVault;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

const UPDATE_OPERATION_ACTIVE_ERROR: &str = "已有更新安装或重启操作正在进行，请稍候";
const AI_OPERATION_ACTIVE_ERROR: &str = "存在进行中的 AI 任务，请等待完成或取消后再安装更新";
const UPDATE_BLOCKS_AI_ERROR: &str = "正在安装更新或准备重启，暂时无法开始 AI 任务";

pub struct OperationCoordinator {
    transition: Mutex<()>,
    update_active: AtomicBool,
    active_ai_operations: AtomicUsize,
}

pub struct UpdateOperationGuard {
    coordinator: Arc<OperationCoordinator>,
}

impl Drop for UpdateOperationGuard {
    fn drop(&mut self) {
        self.coordinator.update_active.store(false, Ordering::Release);
    }
}

pub struct AiOperationGuard {
    coordinator: Arc<OperationCoordinator>,
}

impl Drop for AiOperationGuard {
    fn drop(&mut self) {
        self.coordinator.active_ai_operations.fetch_sub(1, Ordering::AcqRel);
    }
}

impl OperationCoordinator {
    fn new() -> Self {
        Self {
            transition: Mutex::new(()),
            update_active: AtomicBool::new(false),
            active_ai_operations: AtomicUsize::new(0),
        }
    }

    pub async fn begin_update(self: &Arc<Self>) -> Result<UpdateOperationGuard, String> {
        let _transition = self.transition.lock().await;
        if self.update_active.load(Ordering::Acquire) {
            return Err(UPDATE_OPERATION_ACTIVE_ERROR.into());
        }
        if self.active_ai_operations.load(Ordering::Acquire) > 0 {
            return Err(AI_OPERATION_ACTIVE_ERROR.into());
        }
        self.update_active.store(true, Ordering::Release);
        Ok(UpdateOperationGuard { coordinator: self.clone() })
    }

    pub async fn begin_ai(self: &Arc<Self>) -> Result<AiOperationGuard, String> {
        let _transition = self.transition.lock().await;
        if self.update_active.load(Ordering::Acquire) {
            return Err(UPDATE_BLOCKS_AI_ERROR.into());
        }
        self.active_ai_operations.fetch_add(1, Ordering::AcqRel);
        Ok(AiOperationGuard { coordinator: self.clone() })
    }
}

struct AiTaskEntry {
    generation: u64,
    abort_handle: AbortHandle,
}

const AI_CANCEL_RACE_WINDOW: Duration = Duration::from_secs(30);

#[derive(Default)]
struct AiTaskRegistryState {
    tasks: HashMap<String, AiTaskEntry>,
    pending_cancellations: HashMap<String, Instant>,
}

pub struct AiTaskRegistry {
    state: Mutex<AiTaskRegistryState>,
    next_generation: AtomicU64,
}

impl AiTaskRegistry {
    fn new() -> Self {
        Self { state: Mutex::new(AiTaskRegistryState::default()), next_generation: AtomicU64::new(1) }
    }

    pub fn next_generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed)
    }

    pub async fn replace(&self, request_id: String, generation: u64, abort_handle: AbortHandle) {
        let mut state = self.state.lock().await;
        Self::remove_expired_cancellations(&mut state);
        if state.pending_cancellations.remove(&request_id).is_some() {
            abort_handle.abort();
            return;
        }
        if let Some(previous) = state.tasks.insert(request_id, AiTaskEntry { generation, abort_handle }) {
            previous.abort_handle.abort();
        }
    }

    pub async fn cancel(&self, request_id: &str) {
        let mut state = self.state.lock().await;
        Self::remove_expired_cancellations(&mut state);
        if let Some(task) = state.tasks.remove(request_id) {
            task.abort_handle.abort();
        } else {
            state.pending_cancellations.insert(request_id.to_string(), Instant::now());
        }
    }

    pub async fn remove_if_current(&self, request_id: &str, generation: u64) {
        let mut state = self.state.lock().await;
        if state.tasks.get(request_id).is_some_and(|entry| entry.generation == generation) {
            state.tasks.remove(request_id);
        }
    }

    fn remove_expired_cancellations(state: &mut AiTaskRegistryState) {
        state.pending_cancellations.retain(|_, cancelled_at| cancelled_at.elapsed() <= AI_CANCEL_RACE_WINDOW);
    }
}

/// Application state shared across all Tauri commands
pub struct AppState {
    pub http_client: Arc<HttpClient>,
    pub token_vault: Arc<TokenVault>,
    pub ai_config: Arc<AiConfigManager>,
    pub ai_tasks: Arc<AiTaskRegistry>,
    pub operations: Arc<OperationCoordinator>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            http_client: Arc::new(HttpClient::new()),
            token_vault: Arc::new(TokenVault::new()),
            ai_config: Arc::new(AiConfigManager::new()),
            ai_tasks: Arc::new(AiTaskRegistry::new()),
            operations: Arc::new(OperationCoordinator::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AiTaskRegistry, OperationCoordinator, AI_OPERATION_ACTIVE_ERROR, UPDATE_BLOCKS_AI_ERROR,
        UPDATE_OPERATION_ACTIVE_ERROR,
    };
    use std::sync::Arc;

    #[tokio::test]
    async fn cancellation_before_registration_aborts_late_ai_task() {
        let registry = AiTaskRegistry::new();
        let request_id = "draft-request".to_string();
        registry.cancel(&request_id).await;
        let task = tokio::spawn(std::future::pending::<()>());

        registry.replace(request_id, registry.next_generation(), task.abort_handle()).await;

        assert!(task.await.expect_err("task should be cancelled").is_cancelled());
    }

    #[tokio::test]
    async fn cancellation_aborts_registered_ai_task() {
        let registry = AiTaskRegistry::new();
        let request_id = "review-request".to_string();
        let task = tokio::spawn(std::future::pending::<()>());
        registry.replace(request_id.clone(), registry.next_generation(), task.abort_handle()).await;

        registry.cancel(&request_id).await;

        assert!(task.await.expect_err("task should be cancelled").is_cancelled());
    }

    #[tokio::test]
    async fn update_is_rejected_until_all_ai_operations_finish() {
        let coordinator = Arc::new(OperationCoordinator::new());
        let first_ai = coordinator.begin_ai().await.expect("first AI operation should start");
        let second_ai = coordinator.begin_ai().await.expect("concurrent AI operation should start");

        assert_eq!(coordinator.begin_update().await.err().as_deref(), Some(AI_OPERATION_ACTIVE_ERROR));
        drop(first_ai);
        assert_eq!(coordinator.begin_update().await.err().as_deref(), Some(AI_OPERATION_ACTIVE_ERROR));
        drop(second_ai);
        assert!(coordinator.begin_update().await.is_ok());
    }

    #[tokio::test]
    async fn active_update_rejects_new_ai_operations_until_released() {
        let coordinator = Arc::new(OperationCoordinator::new());
        let update = coordinator.begin_update().await.expect("update operation should start");

        assert_eq!(coordinator.begin_update().await.err().as_deref(), Some(UPDATE_OPERATION_ACTIVE_ERROR));
        assert_eq!(coordinator.begin_ai().await.err().as_deref(), Some(UPDATE_BLOCKS_AI_ERROR));
        drop(update);
        assert!(coordinator.begin_ai().await.is_ok());
    }
}
