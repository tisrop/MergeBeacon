import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import UpdateAvailableDialog from "../UpdateAvailableDialog.vue";

const mountedWrappers: ReturnType<typeof mount>[] = [];

function mountDialog(props: Partial<InstanceType<typeof UpdateAvailableDialog>["$props"]> = {}) {
  const wrapper = mount(UpdateAvailableDialog, {
    attachTo: document.body,
    props: {
      open: true,
      version: "0.4.0",
      notes: "## 更顺手的更新\n\n- 优化更新说明",
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

describe("UpdateAvailableDialog", () => {
  it("展示版本和安全渲染的 Markdown 更新说明", async () => {
    mountDialog({
      notes:
        "## 更顺手的更新\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1)) [详情](https://example.com)",
    });
    await flushPromises();

    const dialog = document.body.querySelector('[data-testid="update-available-dialog"]');
    expect(dialog?.textContent).toContain("发现新版本 v0.4.0");
    expect(dialog?.querySelector("h2 + p")?.textContent).toContain("新版本已准备好");
    expect(dialog?.querySelector("script")).toBeNull();
    expect(dialog?.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(dialog?.querySelector('a[href="https://example.com"]')).not.toBeNull();
  });

  it("没有更新说明时展示明确的默认文案", async () => {
    mountDialog({ notes: null });
    await flushPromises();

    const emptyNotes = document.body.querySelector<HTMLElement>(".update-dialog-empty");
    expect(emptyNotes?.textContent).toBe("此版本暂无详细更新说明。");
    expect(document.body.querySelector(".update-dialog-notes")).toBeNull();
  });

  it("确认查看更新，或通过按钮、遮罩和 Escape 稍后处理", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const primary = document.body.querySelector<HTMLButtonElement>(
      ".update-dialog-actions .btn-primary",
    );
    expect(document.activeElement).toBe(primary);
    primary?.click();
    expect(wrapper.emitted("confirm")).toHaveLength(1);

    document.body
      .querySelector<HTMLButtonElement>(".update-dialog-actions .btn:not(.btn-primary)")
      ?.click();
    document.body.querySelector<HTMLButtonElement>(".update-dialog-close")?.click();
    document.body
      .querySelector<HTMLElement>(".update-dialog-backdrop")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toHaveLength(4);

    await wrapper.setProps({ open: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(4);
  });

  it("Tab 键始终将焦点留在弹窗操作范围内", async () => {
    mountDialog();
    await flushPromises();

    const primary = document.body.querySelector<HTMLButtonElement>(
      ".update-dialog-actions .btn-primary",
    );
    const close = document.body.querySelector<HTMLButtonElement>(".update-dialog-close");
    expect(document.activeElement).toBe(primary);

    primary?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(close);

    close?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(primary);
  });
});
