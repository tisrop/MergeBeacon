import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSettings from "../AiSettings.vue";
import { aiListModels } from "@/api";
import { setAppLocale } from "@/i18n";

vi.mock("@/api", () => ({
  aiGetConfig: vi.fn().mockRejectedValue(new Error("no config")),
  aiSaveConfig: vi.fn(),
  aiSaveApiKey: vi.fn(),
  aiTestConnection: vi.fn(),
  aiListModels: vi.fn(),
}));

describe("AiSettings", () => {
  beforeEach(() => {
    setAppLocale("zh-CN");
    vi.mocked(aiListModels).mockResolvedValue([`gpt<img src=x onerror="alert(1)">model`]);
  });

  it("切换界面语言后立即更新设置文案", async () => {
    const wrapper = mount(AiSettings);

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Presets");
    expect(wrapper.text()).toContain("Local Ollama");
    expect(wrapper.text()).toContain("Fetch models");
    expect(wrapper.text()).not.toContain("预设配置");
  });

  it("将恶意模型 ID 作为纯文本渲染", async () => {
    const wrapper = mount(AiSettings);
    const fetchButton = wrapper.findAll("button").find((button) => button.text() === "获取模型");
    expect(fetchButton).toBeDefined();
    await fetchButton!.trigger("click");
    await flushPromises();
    const input = wrapper.get(".model-input-wrap input");
    await input.trigger("focus");
    await input.setValue("gpt");

    expect(wrapper.get(".model-item").text()).toContain('<img src=x onerror="alert(1)">');
    expect(wrapper.find(".model-item img").exists()).toBe(false);
    expect(wrapper.get(".model-item").element.querySelector("[onerror]")).toBeNull();
  });
});
