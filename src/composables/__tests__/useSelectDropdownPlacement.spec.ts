import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSelectDropdownPlacement,
  verticalClippingBoundary,
  type SelectDropdownPlacementOptions,
} from "@/composables/useSelectDropdownPlacement";

type PlacementApi = ReturnType<typeof useSelectDropdownPlacement>;

const mountedHosts = new Set<() => void>();

function readDynamicRule(): string {
  const el = document.querySelector("style[data-mergebeacon-dynamic-css]");
  return el?.textContent ?? "";
}

function rect(top: number, bottom: number) {
  return {
    x: 0,
    y: top,
    top,
    right: 0,
    bottom,
    left: 0,
    width: 0,
    height: Math.max(0, bottom - top),
    toJSON: () => ({}),
  };
}

function mockBoundingRects(map: Record<string, ReturnType<typeof rect>>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      for (const [selector, value] of Object.entries(map)) {
        if (this.classList.contains(selector)) return value;
      }
      return rect(0, 0);
    },
  );
}

function mountPlacementHost(options?: {
  scroller?: boolean;
  onSetup?: (open: ReturnType<typeof ref<boolean>>) => SelectDropdownPlacementOptions;
}) {
  let api: PlacementApi | null = null;
  const open = ref(false);
  const triggerRef = ref<HTMLElement | null>(null);
  const dropdownRef = ref<HTMLElement | null>(null);
  const opts: SelectDropdownPlacementOptions = options?.onSetup?.(open) ?? {
    open,
    triggerRef,
    dropdownRef,
    cssPrefix: "test-dropdown",
    cssVarName: "--test-dropdown-max-height",
  };
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useSelectDropdownPlacement(opts);
        const rootClass = options?.scroller ? ["scroller"] : [];
        return () =>
          h("div", { class: rootClass }, [
            h("div", { ref: triggerRef, class: "trigger" }),
            open.value ? h("div", { ref: dropdownRef, class: "dropdown" }) : null,
          ]);
      },
    }),
    { attachTo: document.body },
  );
  const unmount = () => {
    mountedHosts.delete(unmount);
    wrapper.unmount();
  };
  mountedHosts.add(unmount);
  return {
    wrapper,
    open,
    unmount,
    get api() {
      return api as unknown as PlacementApi;
    },
  };
}

describe("useSelectDropdownPlacement", () => {
  beforeEach(() => {
    vi.stubGlobal("innerHeight", 760);
  });

  afterEach(() => {
    for (const unmount of mountedHosts) unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("下方空间充足时向下展开并将 max-height clamp 到上限 280px", async () => {
    mockBoundingRects({ trigger: rect(100, 138) });
    const host = mountPlacementHost();

    host.open.value = true;
    await flushPromises();

    expect(host.api.dropdownPlacement.value).toBe("down");
    expect(readDynamicRule()).toContain("--test-dropdown-max-height: 280px");
  });

  it("下方空间不足且上方更宽时翻转为向上展开", async () => {
    mockBoundingRects({ trigger: rect(700, 738) });
    const host = mountPlacementHost();

    host.open.value = true;
    await flushPromises();

    expect(host.api.dropdownPlacement.value).toBe("up");
    // 向上时仍按上方可用空间 clamp；此处上方充足，落在上限 280px。
    expect(readDynamicRule()).toContain("--test-dropdown-max-height: 280px");
  });

  it("双向空间都小于最小高度时 clamp 到下界 64px", async () => {
    mockBoundingRects({ scroller: rect(20, 120), trigger: rect(50, 88) });
    vi.spyOn(window, "getComputedStyle").mockImplementation((elt) => {
      const base = {
        overflow: "visible",
        overflowY: "visible",
      } as Record<string, string>;
      if (elt instanceof HTMLElement && elt.classList.contains("scroller")) {
        base.overflow = "auto";
      }
      return base as unknown as CSSStyleDeclaration;
    });
    const host = mountPlacementHost({ scroller: true });

    host.open.value = true;
    await flushPromises();

    // 上方 26、下方 28，均不足 64；下方仍略大，保持向下但 clamp 到最小高度。
    expect(host.api.dropdownPlacement.value).toBe("down");
    expect(readDynamicRule()).toContain("--test-dropdown-max-height: 64px");
  });

  it("内容变化触发重新测量并刷新动态高度", async () => {
    let triggerTop = 100;
    mockBoundingRects({ trigger: rect(triggerTop, triggerTop + 38) });
    const recalc = ref(0);
    const open = ref(false);
    const triggerRef = ref<HTMLElement | null>(null);
    const dropdownRef = ref<HTMLElement | null>(null);
    let api: PlacementApi | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useSelectDropdownPlacement({
            open,
            triggerRef,
            dropdownRef,
            cssPrefix: "test-dropdown-recalc",
            cssVarName: "--test-dropdown-recalc-max-height",
            recalcTrigger: recalc,
          });
          return () =>
            h("div", [
              h("div", { ref: triggerRef, class: "trigger" }),
              open.value ? h("div", { ref: dropdownRef, class: "dropdown" }) : null,
            ]);
        },
      }),
      { attachTo: document.body },
    );

    open.value = true;
    await flushPromises();
    expect(readDynamicRule()).toContain("--test-dropdown-recalc-max-height: 280px");

    // 触发器移近视口底部，使下方空间不足 -> 重新测量后翻转为 up。
    triggerTop = 700;
    (HTMLElement.prototype.getBoundingClientRect as ReturnType<typeof vi.spyOn>).mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("trigger")) return rect(triggerTop, triggerTop + 38);
        return rect(0, 0);
      },
    );

    recalc.value = 1;
    await flushPromises();

    expect(api!.dropdownPlacement.value).toBe("up");
    wrapper.unmount();
  });

  it("几何未变化时重复触发不重写动态样式表", async () => {
    mockBoundingRects({ trigger: rect(100, 138) });
    const host = mountPlacementHost();

    host.open.value = true;
    await flushPromises();

    const updateSpy = vi.spyOn(host.api.dropdownCssClass, "update");

    // 模拟 dropdown 打开期间的高频 scroll/resize：几何不变，本实例 update 不应被调用。
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("几何变化后越过缓存重新写入样式", async () => {
    let triggerTop = 100;
    mockBoundingRects({ trigger: rect(triggerTop, triggerTop + 38) });
    const host = mountPlacementHost();

    host.open.value = true;
    await flushPromises();
    expect(host.api.dropdownPlacement.value).toBe("down");

    // 触发器移到视口底部，下方空间不足 -> 翻转为 up，缓存失效后必须重新写入。
    triggerTop = 700;
    (HTMLElement.prototype.getBoundingClientRect as ReturnType<typeof vi.spyOn>).mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("trigger")) return rect(triggerTop, triggerTop + 38);
        return rect(0, 0);
      },
    );
    const updateSpy = vi.spyOn(host.api.dropdownCssClass, "update");

    window.dispatchEvent(new Event("resize"));

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(host.api.dropdownPlacement.value).toBe("up");
  });

  it("卸载后移除 resize 与 scroll 监听器并释放动态样式", async () => {
    mockBoundingRects({ trigger: rect(100, 138) });
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const host = mountPlacementHost();

    host.open.value = true;
    await flushPromises();

    const resizeHandler = windowAdd.mock.calls.find((c) => c[0] === "resize")?.[1];
    const scrollHandler = documentAdd.mock.calls.find((c) => c[0] === "scroll")?.[1];
    expect(resizeHandler).toBeTruthy();
    expect(scrollHandler).toBeTruthy();

    const className = host.api.dropdownCssClass.className;
    expect(readDynamicRule()).toContain(`.${className}`);

    host.unmount();

    expect(windowRemove).toHaveBeenCalledWith("resize", resizeHandler);
    expect(documentRemove).toHaveBeenCalledWith("scroll", scrollHandler, true);
    expect(readDynamicRule()).not.toContain(`.${className}`);
  });
});

describe("verticalClippingBoundary", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("沿 overflow 祖先收缩可视边界，忽略 visible 祖先", () => {
    const scroller = document.createElement("div");
    scroller.className = "scroller";
    scroller.style.overflow = "auto";
    const inner = document.createElement("div");
    const trigger = document.createElement("div");
    trigger.className = "trigger";
    inner.append(trigger);
    scroller.append(inner);
    document.body.append(scroller);

    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(40, 320));
    vi.spyOn(window, "getComputedStyle").mockImplementation((elt) => {
      const base = { overflow: "visible", overflowY: "visible" } as Record<string, string>;
      if (elt === scroller) {
        base.overflow = "auto";
      }
      return base as unknown as CSSStyleDeclaration;
    });

    const boundary = verticalClippingBoundary(trigger);
    expect(boundary).toEqual({ top: 40, bottom: 320 });
  });

  it("没有 overflow 祖先时退化为视口边界", () => {
    vi.stubGlobal("innerHeight", 900);
    const trigger = document.createElement("div");
    document.body.append(trigger);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      overflow: "visible",
      overflowY: "visible",
    } as unknown as CSSStyleDeclaration);

    expect(verticalClippingBoundary(trigger)).toEqual({ top: 0, bottom: 900 });
  });
});
