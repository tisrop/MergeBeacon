import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import CloseConfirmDialog from "../CloseConfirmDialog.vue";

const mountedWrappers: ReturnType<typeof mount>[] = [];

function mountDialog(props: Partial<InstanceType<typeof CloseConfirmDialog>["$props"]> = {}) {
  const wrapper = mount(CloseConfirmDialog, {
    attachTo: document.body,
    props: {
      open: true,
      title: "关闭 PR #42？",
      repository: "owner/repo",
      target: "#42 修复登录竞态",
      impact: "关闭后，该 PR 将无法合并。",
      warning: "此操作不会删除分支或提交。",
      confirmLabel: "关闭 PR",
      loading: false,
      error: "",
      ...props,
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

describe("CloseConfirmDialog", () => {
  it("展示关闭目标和影响，并默认聚焦取消按钮", async () => {
    mountDialog();
    await flushPromises();

    const dialog = document.body.querySelector('[data-testid="close-confirm-dialog"]');
    const cancel = document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]');

    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("close-confirm-dialog-title");
    expect(dialog?.textContent).toContain("owner/repo");
    expect(dialog?.textContent).toContain("#42 修复登录竞态");
    expect(dialog?.textContent).toContain("该 PR 将无法合并");
    expect(document.activeElement).toBe(cancel);
  });

  it("支持确认、按钮取消、遮罩取消和 Escape 取消", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')?.click();
    expect(wrapper.emitted("confirm")).toHaveLength(1);

    document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]')?.click();
    document.body
      .querySelector<HTMLElement>(".close-confirm-dialog-backdrop")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("cancel")).toHaveLength(3);
  });

  it("关闭期间禁止重复操作，并就近展示错误", async () => {
    const wrapper = mountDialog({ loading: true, error: "远端拒绝关闭" });
    await flushPromises();

    const confirm = document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]');
    const cancel = document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]');
    expect(confirm?.disabled).toBe(true);
    expect(confirm?.textContent).toContain("正在关闭");
    expect(cancel?.disabled).toBe(true);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("远端拒绝关闭");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("cancel")).toBeUndefined();
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("Tab 键将焦点保持在确认框内", async () => {
    mountDialog();
    await flushPromises();

    const cancel = document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]');
    const confirm = document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]');
    expect(document.activeElement).toBe(cancel);

    cancel?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(confirm);

    confirm?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(cancel);
  });
});
