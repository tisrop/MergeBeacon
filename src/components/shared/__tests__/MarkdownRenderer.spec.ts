import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import { clipboardWriteText } from "@/api";

vi.mock("@/api", () => ({
  clipboardWriteText: vi.fn(),
}));

describe("MarkdownRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clipboardWriteText).mockResolvedValue();
  });

  it("渲染 GFM Markdown 并清理脚本和危险链接", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          "# 标题\n\n- 项目\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1)) [安全](https://example.com)",
      },
    });

    expect(wrapper.find("h1").text()).toBe("标题");
    expect(wrapper.find("li").text()).toBe("项目");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("a[href^='javascript:']").exists()).toBe(false);
    expect(wrapper.find("a[href='https://example.com']").attributes("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("移除协议相对链接和图片并保留本地路径", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          "[协议相对链接](//evil.example/phish) ![协议相对图片](//evil.example/pixel.png)\n\n" +
          '<a href="\\\\evil.example/phish">反斜杠链接</a> ' +
          "[本地链接](/docs/review) ![本地图片](./assets/diagram.png)",
      },
    });

    expect(wrapper.find("a[href='//evil.example/phish']").exists()).toBe(false);
    expect(wrapper.find("img[src='//evil.example/pixel.png']").exists()).toBe(false);
    expect(wrapper.find("a[href^='\\\\evil.example']").exists()).toBe(false);
    expect(wrapper.find("a[href='/docs/review']").exists()).toBe(true);
    expect(wrapper.find("img[src='./assets/diagram.png']").exists()).toBe(true);
  });

  it("可按文档排版合并普通换行", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "这是一段为了源码可读性\n分成两行的说明。",
        breaks: false,
      },
    });

    expect(wrapper.get("p").text()).toBe("这是一段为了源码可读性\n分成两行的说明。");
    expect(wrapper.find("br").exists()).toBe(false);
  });

  it("仅在显式指定时启用文档排版变体", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "# 标题\n\n正文",
      },
    });

    expect(wrapper.classes()).not.toContain("markdown-renderer-document");

    await wrapper.setProps({ variant: "document" });

    expect(wrapper.classes()).toContain("markdown-renderer-document");
  });

  it("为文档代码块提供复制按钮并反馈成功状态", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "行内 `value`\n\n```ts\nconst value = 1;\n```",
        variant: "document",
      },
    });

    const button = wrapper.get<HTMLButtonElement>("[data-code-copy]");
    expect(wrapper.findAll("[data-code-copy]")).toHaveLength(1);
    expect(button.attributes("aria-label")).toBe("复制代码");

    await button.trigger("click");
    await flushPromises();

    expect(clipboardWriteText).toHaveBeenCalledWith("const value = 1;\n");
    expect(button.attributes("data-copy-state")).toBe("copied");
    expect(button.attributes("aria-label")).toBe("代码已复制");
    expect(wrapper.get("[role='status']").text()).toBe("代码已复制");
    wrapper.unmount();
  });

  it("复制失败时保留代码并显示可访问的错误反馈", async () => {
    vi.mocked(clipboardWriteText).mockRejectedValue(new Error("clipboard denied"));
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "```\necho test\n```",
        variant: "document",
      },
    });

    const button = wrapper.get<HTMLButtonElement>("[data-code-copy]");
    await button.trigger("click");
    await flushPromises();

    expect(wrapper.get("code").text()).toBe("echo test");
    expect(button.attributes("data-copy-state")).toBe("error");
    expect(wrapper.get("[role='status']").text()).toContain("clipboard denied");
    wrapper.unmount();
  });
});
