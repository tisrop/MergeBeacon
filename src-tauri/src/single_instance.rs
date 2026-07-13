use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

#[derive(Default)]
pub struct ActivationCoordinator {
    ready: AtomicBool,
    pending: AtomicBool,
}

impl ActivationCoordinator {
    /// 记录第二实例的激活请求；窗口恢复完成后才允许实际激活。
    pub fn request_activation(&self) -> bool {
        self.pending.store(true, Ordering::Release);
        self.drain_if_ready()
    }

    /// 标记主窗口已完成状态恢复，并消费恢复期间合并排队的激活请求。
    pub fn mark_ready(&self) -> bool {
        self.ready.store(true, Ordering::Release);
        self.drain_if_ready()
    }

    fn drain_if_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire) && self.pending.swap(false, Ordering::AcqRel)
    }
}

pub fn activate_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("激活主窗口失败：找不到 main 窗口");
        return;
    };

    // 每一步都尽力执行，避免某个平台不支持其中一步时阻断后续聚焦。
    if let Err(error) = window.unminimize() {
        eprintln!("恢复最小化窗口失败：{error}");
    }
    if let Err(error) = window.show() {
        eprintln!("显示主窗口失败：{error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("聚焦主窗口失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::ActivationCoordinator;

    #[test]
    fn queues_activation_until_window_is_ready() {
        let coordinator = ActivationCoordinator::default();
        assert!(!coordinator.request_activation());
        assert!(coordinator.mark_ready());
    }

    #[test]
    fn activates_immediately_after_window_is_ready() {
        let coordinator = ActivationCoordinator::default();
        assert!(!coordinator.mark_ready());
        assert!(coordinator.request_activation());
    }

    #[test]
    fn coalesces_repeated_pending_requests() {
        let coordinator = ActivationCoordinator::default();
        assert!(!coordinator.request_activation());
        assert!(!coordinator.request_activation());
        assert!(coordinator.mark_ready());
        assert!(!coordinator.mark_ready());
    }

    #[test]
    fn consumes_each_ready_request_only_once() {
        let coordinator = ActivationCoordinator::default();
        assert!(!coordinator.mark_ready());
        assert!(coordinator.request_activation());
        assert!(!coordinator.mark_ready());
        assert!(coordinator.request_activation());
    }
}
