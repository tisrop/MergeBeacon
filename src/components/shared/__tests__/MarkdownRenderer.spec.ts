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

  it("拒绝编码后的危险协议并移除可执行容器", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          '<a href="jav&#x61;script:alert(1)" onclick="alert(2)">编码链接</a>' +
          '<img src="data:image/svg+xml,<svg onload=alert(3)></svg>" alt="危险图片">' +
          '<iframe src="https://example.com"><p>iframe 内容</p></iframe>' +
          '<form action="https://example.com"><input name="token"></form>',
      },
    });

    const link = wrapper.get("a");
    expect(link.attributes("href")).toBeUndefined();
    expect(link.attributes("onclick")).toBeUndefined();
    expect(wrapper.get("img").attributes("src")).toBeUndefined();
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("iframe 内容");
  });

  it("拒绝用户提供的 data 视频地址", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          "[内联视频](data:video/mp4;base64,AAAAHGZ0eXBtcDQy)" +
          '<video controls src="data:video/mp4;base64,AAAAHGZ0eXBtcDQy">视频</video>',
      },
    });

    expect(wrapper.find("video").exists()).toBe(false);
    expect(wrapper.get("a").attributes("href")).toBeUndefined();
  });

  it("将 GitHub 无扩展名视频附件探测为可播放媒体", async () => {
    const attachmentUrl =
      "https://github.com/user-attachments/assets/f69a3ffc-b901-437d-8b98-5ad2aae384bb";
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: attachmentUrl,
        variant: "document",
      },
    });

    const video = wrapper.get<HTMLVideoElement>("video[data-media-attachment-preview]");
    const fallback = wrapper.get<HTMLAnchorElement>("a[data-media-attachment-fallback]");
    expect(video.attributes("src")).toBe(attachmentUrl);
    expect(video.attributes("controls")).toBeDefined();
    expect(video.attributes("playsinline")).toBeDefined();
    expect(video.attributes("preload")).toBe("metadata");
    expect(video.attributes("data-media-attachment-preview")).toBe("pending");
    expect(video.attributes("hidden")).toBeUndefined();
    expect(video.attributes("aria-hidden")).toBeUndefined();
    expect(fallback.attributes("hidden")).toBeDefined();

    await video.trigger("loadedmetadata");

    expect(video.attributes("data-media-attachment-preview")).toBe("ready");
    expect(video.attributes("aria-hidden")).toBeUndefined();
    expect(fallback.attributes("hidden")).toBeDefined();
  });

  it("视频附件探测失败时保留原始链接", async () => {
    const attachmentUrl =
      "https://github.com/user-attachments/assets/f69a3ffc-b901-437d-8b98-5ad2aae384bb";
    const wrapper = mount(MarkdownRenderer, {
      props: { content: attachmentUrl },
    });

    await wrapper.get("video[data-media-attachment-preview]").trigger("error");

    expect(wrapper.find("video[data-media-attachment-preview]").exists()).toBe(false);
    expect(wrapper.get("a[data-media-attachment-fallback]").attributes("hidden")).toBeUndefined();
  });

  it("不将伪造或非 GitHub 的附件链接转换为视频", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          "https://evil.example/user-attachments/assets/f69a3ffc-b901-437d-8b98-5ad2aae384bb\n\n" +
          "https://github.com/user-attachments/assets/not-a-uuid",
      },
    });

    expect(wrapper.find("video").exists()).toBe(false);
    expect(wrapper.findAll("a")).toHaveLength(2);
  });

  it("支持 GitHub 可信附件域上的常见视频扩展名", () => {
    const webmUrl = "https://user-images.githubusercontent.com/42/demo.webm";
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: `${webmUrl}\n\nhttps://user-images.githubusercontent.com/42/screenshot.png`,
      },
    });

    expect(wrapper.findAll("video")).toHaveLength(1);
    expect(wrapper.get("video").attributes("src")).toBe(webmUrl);
    expect(wrapper.findAll("a")).toHaveLength(2);
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

  it("将调用方 class 与 Markdown 根样式合并", () => {
    const wrapper = mount(MarkdownRenderer, {
      attrs: { class: "metadata-markdown" },
      props: { content: "正文" },
    });

    expect(wrapper.classes()).toContain("markdown-renderer");
    expect(wrapper.classes()).toContain("metadata-markdown");
  });

  it("保留 GitHub details 折叠块并支持原生展开", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "<details><summary>Release notes</summary><p>Changelog and commits</p></details>",
      },
    });

    const details = wrapper.get<HTMLDetailsElement>("details");
    expect(details.element.open).toBe(false);
    expect(wrapper.get("summary").text()).toBe("Release notes");
    expect(details.text()).toContain("Changelog and commits");

    await wrapper.get("summary").trigger("click");
    expect(details.element.open).toBe(true);
  });

  it("保留可信的 open 状态并移除 details 事件属性", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          '<details open onclick="alert(1)"><summary>Maintainer changes</summary><p>Commits</p></details>',
      },
    });

    const details = wrapper.get<HTMLDetailsElement>("details");
    expect(details.element.open).toBe(true);
    expect(details.attributes("onclick")).toBeUndefined();
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

  it("可由父组件接管安全链接点击", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: "[Issue](https://github.com/team/repo/issues/12)",
        linkMode: "emit",
      },
    });

    await wrapper.get("a").trigger("click");

    expect(wrapper.emitted("link-click")?.[0]).toEqual([
      {
        href: "https://github.com/team/repo/issues/12",
        text: "Issue",
        title: null,
      },
    ]);
  });

  it("将普通文本中的仓库编号渲染为链接，并跳过已有链接和代码", () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          "The a11y scan (#7086) measures contrast. " +
          "[existing #7100](https://github.com/team/repo/pull/7100) `#7200`",
        repositoryReferences: true,
      },
    });

    const reference = wrapper.get("a[href='/__mergebeacon__/reference/hash/7086']");
    expect(reference.text()).toBe("#7086");
    expect(wrapper.find("a[href='/__mergebeacon__/reference/hash/7100']").exists()).toBe(false);
    expect(wrapper.get("a[href='https://github.com/team/repo/pull/7100']").text()).toBe(
      "existing #7100",
    );
    expect(wrapper.get("code").text()).toBe("#7200");
  });
});
