import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import { setAppLocale } from "@/i18n";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import type { DiffLocationRequest, DiffResult, Platform, PrFileContent } from "@/types";

const {
  prFileContentMock,
  reviewViewedFilesListMock,
  reviewFileSetViewedMock,
  clipboardWriteTextMock,
} = vi.hoisted(() => ({
  prFileContentMock: vi.fn(),
  reviewViewedFilesListMock: vi.fn(),
  reviewFileSetViewedMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
}));

vi.mock("@/api", () => ({
  prFileContent: prFileContentMock,
  reviewViewedFilesList: reviewViewedFilesListMock,
  reviewFileSetViewed: reviewFileSetViewedMock,
  clipboardWriteText: clipboardWriteTextMock,
}));

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

beforeEach(() => {
  setAppLocale("zh-CN");
});

const diff: DiffResult = {
  diff: `diff --git a/src/components/App.ts b/src/components/App.ts
index 1111111..2222222 100644
--- a/src/components/App.ts
+++ b/src/components/App.ts
@@ -1 +1 @@
-export const state = "old";
+export const state = "new";
diff --git a/tests/App.spec.ts b/tests/App.spec.ts
index 3333333..4444444 100644
--- a/tests/App.spec.ts
+++ b/tests/App.spec.ts
@@ -1 +1,2 @@
 describe("App", () => {});
+it("works", () => {});`,
  files: [
    {
      filename: "src/components/App.ts",
      status: "modified",
      patch: '@@ -1 +1 @@\n-export const state = "old";\n+export const state = "new";',
      additions: 1,
      deletions: 1,
    },
    {
      filename: "tests/App.spec.ts",
      status: "added",
      patch: '@@ -1 +1,2 @@\n describe("App", () => {});\n+it("works", () => {});',
      additions: 1,
      deletions: 0,
    },
  ],
  patch_schema_version: 1,
  patches: [],
};

interface ContextProps {
  platform?: Platform;
  owner?: string;
  repo?: string;
  prNumber?: number;
  baseSha?: string;
  headSha?: string;
  baseOwner?: string;
  baseRepo?: string;
  headOwner?: string;
  headRepo?: string;
  locationRequest?: DiffLocationRequest | null;
  canSyncViewedFiles?: boolean;
  readOnly?: boolean;
}

async function mountViewer(value = diff, extraProps: ContextProps = {}) {
  const wrapper = mount(DiffViewer, { props: { diff: value, ...extraProps } });
  await flushPromises();
  return wrapper;
}

async function setCodeSearchQuery(
  search: { setValue(value: string): Promise<void> },
  query: string,
): Promise<void> {
  await flushPromises();
  vi.useFakeTimers();
  try {
    await search.setValue(query);
    await vi.advanceTimersByTimeAsync(75);
    await flushPromises();
  } finally {
    vi.useRealTimers();
  }
}

const standardizedDiff: DiffResult = {
  diff: "",
  files: [
    {
      filename: "src/components/App.ts",
      status: "modified",
      patch: "",
      additions: 1,
      deletions: 1,
    },
    {
      filename: "tests/App.spec.ts",
      status: "added",
      patch: "",
      additions: 1,
      deletions: 0,
    },
  ],
  patch_schema_version: 1,
  patches: [
    {
      filename: "src/components/App.ts",
      old_path: "src/components/App.ts",
      new_path: "src/components/App.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      content_kind: "text",
      patch: "",
      message: null,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          old_start: 1,
          old_count: 2,
          new_start: 1,
          new_count: 2,
          section_header: null,
          lines: [
            { kind: "context", content: "const state = true;", old_line: 1, new_line: 1 },
            { kind: "deletion", content: 'const value = "<old>";', old_line: 2, new_line: null },
            { kind: "addition", content: 'const value = "<new>";', old_line: null, new_line: 2 },
          ],
        },
      ],
    },
    {
      filename: "tests/App.spec.ts",
      old_path: null,
      new_path: "tests/App.spec.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      content_kind: "text",
      patch: "",
      message: null,
      hunks: [
        {
          header: "@@ -0,0 +1 @@",
          old_start: 0,
          old_count: 0,
          new_start: 1,
          new_count: 1,
          section_header: null,
          lines: [{ kind: "addition", content: 'it("works");', old_line: null, new_line: 1 }],
        },
      ],
    },
  ],
};

const contextDiff: DiffResult = {
  diff: "",
  files: [
    {
      filename: "src/context.ts",
      status: "modified",
      patch: "",
      additions: 0,
      deletions: 0,
    },
  ],
  patch_schema_version: 1,
  patches: [
    {
      filename: "src/context.ts",
      old_path: "src/context.old.ts",
      new_path: "src/context.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      content_kind: "text",
      patch: "",
      message: null,
      hunks: [
        {
          header: "@@ -3 +3 @@",
          old_start: 3,
          old_count: 1,
          new_start: 3,
          new_count: 1,
          section_header: null,
          lines: [{ kind: "context", content: "unchanged 3", old_line: 3, new_line: 3 }],
        },
        {
          header: "@@ -7 +7 @@",
          old_start: 7,
          old_count: 1,
          new_start: 7,
          new_count: 1,
          section_header: null,
          lines: [{ kind: "context", content: "unchanged 7", old_line: 7, new_line: 7 }],
        },
      ],
    },
  ],
};

const contextProps: Required<ContextProps> = {
  platform: "github",
  owner: "octo",
  repo: "demo",
  prNumber: 42,
  baseSha: "base-sha",
  headSha: "head-sha",
  baseOwner: "octo",
  baseRepo: "demo",
  headOwner: "octo",
  headRepo: "demo",
  locationRequest: null,
  canSyncViewedFiles: false,
  readOnly: false,
};

function fileContent(path: string, revision: string, content: string): PrFileContent {
  return { path, revision, content, truncated: false, binary: false };
}

function mockContextFiles(options?: { truncated?: boolean; binary?: boolean }): void {
  prFileContentMock.mockImplementation(
    async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) => ({
      ...fileContent(
        path,
        revision,
        [
          revision === "base-sha" ? "base 1" : "<script>alert(1)</script>",
          `${revision} 2`,
          "unchanged 3",
          `${revision} 4`,
          `${revision} 5`,
          `${revision} 6`,
          "unchanged 7",
          `${revision} 8`,
        ].join("\n"),
      ),
      truncated: options?.truncated ?? false,
      binary: options?.binary ?? false,
    }),
  );
}

describe("DiffViewer 受控标准 patch", () => {
  beforeEach(() => {
    storage.clear();
    prFileContentMock.mockReset();
    setActivePinia(createPinia());
  });

  it("使用标准 patch 受控渲染 hunk、双侧行号和纯文本代码", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    expect(wrapper.find(".legacy-diff").exists()).toBe(false);
    expect(wrapper.get(".controlled-file-wrapper").attributes("data-file-path")).toBe(
      "src/components/App.ts",
    );
    expect(wrapper.findAll(".controlled-hunk-header")).toHaveLength(2);
    expect(wrapper.findAll(".controlled-hunk-header-text")).toHaveLength(1);
    expect(wrapper.get(".controlled-side-left .controlled-hunk-header").text()).toBe(
      "@@ -1,2 +1,2 @@",
    );
    expect(wrapper.get(".controlled-side-right .controlled-hunk-header").text()).toBe("");
    expect(wrapper.findAll(".controlled-line-deletion")).toHaveLength(1);
    expect(wrapper.findAll(".controlled-line-addition")).toHaveLength(1);
    expect(wrapper.get(".controlled-side-left").text()).toContain("<old>");
    expect(wrapper.get(".controlled-side-right").text()).toContain("<new>");
    expect(
      wrapper.get(".controlled-side-left .controlled-line-deletion").attributes("data-line"),
    ).toBe("2");
    expect(
      wrapper.get(".controlled-side-right .controlled-line-addition").attributes("data-line"),
    ).toBe("2");
    expect(wrapper.find(".controlled-side-left script").exists()).toBe(false);
  });

  it("切换界面语言时立即更新本地文案并保留远端文件名和代码", async () => {
    const remoteChineseDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "src/中文模块.ts",
          status: "modified",
          patch: "",
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "src/中文模块.ts",
          old_path: "src/中文模块.ts",
          new_path: "src/中文模块.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          content_kind: "text",
          patch: "",
          message: null,
          hunks: [
            {
              header: "@@ -1 +1 @@",
              old_start: 1,
              old_count: 1,
              new_start: 1,
              new_count: 1,
              section_header: null,
              lines: [
                {
                  kind: "deletion",
                  content: 'export const 标题 = "旧标题";',
                  old_line: 1,
                  new_line: null,
                },
                {
                  kind: "addition",
                  content: 'export const 标题 = "新标题";',
                  old_line: null,
                  new_line: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    const wrapper = await mountViewer(remoteChineseDiff);

    expect(wrapper.get(".navigator-header strong").text()).toBe("文件");
    expect(wrapper.get(".selected-file-status").text()).toBe("修改");
    expect(wrapper.text()).toContain("src/中文模块.ts");
    expect(wrapper.text()).toContain('export const 标题 = "新标题";');

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".navigator-header strong").text()).toBe("Files");
    expect(wrapper.get(".selected-file-status").text()).toBe("Modified");
    wrapper.get('[aria-label="Find in code"]');
    expect(wrapper.text()).toContain("src/中文模块.ts");
    expect(wrapper.text()).toContain('export const 标题 = "新标题";');
  });

  it("切换文件时只渲染对应的标准 patch", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[data-file-path="tests/App.spec.ts"]').trigger("click");
    await flushPromises();

    expect(wrapper.get(".controlled-file-wrapper").attributes("data-file-path")).toBe(
      "tests/App.spec.ts",
    );
    expect(wrapper.get(".controlled-side-right").text()).toContain('it("works");');
    expect(wrapper.findAll(".controlled-line-addition")).toHaveLength(1);
  });

  it("支持搜索当前标准 patch 并循环定位匹配项", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="right"]');
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(search, "<NEW>");

    expect(pane.get(".code-search-result").text()).toBe("1/1");
    expect(wrapper.findAll("mark.diff-search-match")).toHaveLength(1);
    expect(wrapper.get("mark.diff-search-match.active").text()).toBe("<new>");

    await setCodeSearchQuery(search, "const");
    expect(pane.get(".code-search-result").text()).toBe("1/2");

    await search.trigger("keydown", { key: "Enter" });
    expect(pane.get(".code-search-result").text()).toBe("2/2");
    await search.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(pane.get(".code-search-result").text()).toBe("1/2");
    await pane.get('[aria-label="右侧上一个匹配项"]').trigger("click");
    expect(pane.get(".code-search-result").text()).toBe("2/2");
  });

  it("搜索框清除按钮只清空当前侧并保持输入焦点", async () => {
    const wrapper = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff: standardizedDiff },
    });
    await flushPromises();

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const leftPane = wrapper.get('.code-search-pane[data-side="left"]');
    const rightPane = wrapper.get('.code-search-pane[data-side="right"]');
    const leftSearch = leftPane.get<HTMLInputElement>('input[type="search"]');
    const rightSearch = rightPane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(leftSearch, "state");
    await setCodeSearchQuery(rightSearch, "const");

    await leftPane.get('[aria-label="清空左侧查找"]').trigger("click");
    await flushPromises();

    expect(leftSearch.element.value).toBe("");
    expect(leftPane.find('[aria-label="清空左侧查找"]').exists()).toBe(false);
    expect(rightSearch.element.value).toBe("const");
    expect(rightPane.get(".code-search-result").text()).toBe("1/2");
    expect(document.activeElement).toBe(leftSearch.element);
    wrapper.unmount();
  });

  it("左右侧搜索独立维护查询和导航位置", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const panes = wrapper.findAll(".code-search-pane");
    expect(panes).toHaveLength(2);
    const leftSearch = panes[0].get<HTMLInputElement>('input[type="search"]');
    const rightSearch = panes[1].get<HTMLInputElement>('input[type="search"]');
    expect(leftSearch.attributes("placeholder")).toBeUndefined();
    expect(rightSearch.attributes("placeholder")).toBeUndefined();
    expect(panes[0].get(".code-search-result").text()).toBe("");
    expect(panes[1].get(".code-search-result").text()).toBe("");

    await setCodeSearchQuery(leftSearch, "const");
    await setCodeSearchQuery(rightSearch, "const");
    expect(panes[0].get(".code-search-result").text()).toBe("1/2");
    expect(panes[1].get(".code-search-result").text()).toBe("1/2");

    await panes[0].get('[aria-label="左侧下一个匹配项"]').trigger("click");
    expect(panes[0].get(".code-search-result").text()).toBe("2/2");
    expect(panes[1].get(".code-search-result").text()).toBe("1/2");
  });

  it("放大镜按最近鼠标所在代码侧打开，未检测到代码侧时同时打开两侧", async () => {
    const wrapper = await mountViewer(standardizedDiff);
    const toggle = wrapper.get('[aria-label="查找代码"]');

    await toggle.trigger("click");
    expect(wrapper.findAll(".code-search-pane")).toHaveLength(2);
    await toggle.trigger("click");

    await wrapper.get(".controlled-side-left").trigger("pointerenter");
    await wrapper.get(".controlled-side-left").trigger("pointerleave");
    await toggle.trigger("click");
    expect(wrapper.find('.code-search-pane[data-side="left"]').exists()).toBe(true);
    expect(wrapper.find('.code-search-pane[data-side="right"]').exists()).toBe(false);
    await toggle.trigger("click");

    await wrapper.get(".controlled-side-right").trigger("pointerenter");
    await wrapper.get(".controlled-side-right").trigger("pointerleave");
    await toggle.trigger("click");
    expect(wrapper.find('.code-search-pane[data-side="left"]').exists()).toBe(false);
    expect(wrapper.find('.code-search-pane[data-side="right"]').exists()).toBe(true);
  });

  it("连续输入时只在最后一次停顿后刷新搜索结果", async () => {
    vi.useFakeTimers();
    const wrapper = await mountViewer(standardizedDiff);

    try {
      await wrapper.get('[aria-label="查找代码"]').trigger("click");
      const pane = wrapper.get('.code-search-pane[data-side="left"]');
      const search = pane.get<HTMLInputElement>('input[type="search"]');
      await search.setValue("state");
      await vi.advanceTimersByTimeAsync(75);
      await flushPromises();
      expect(wrapper.get("mark.diff-search-match.active").text()).toBe("state");

      await search.setValue("con");
      await vi.advanceTimersByTimeAsync(50);
      await search.setValue("const");
      await vi.advanceTimersByTimeAsync(74);
      await flushPromises();
      expect(wrapper.get("mark.diff-search-match.active").text()).toBe("state");

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(pane.get(".code-search-result").text()).toBe("1/2");
      expect(wrapper.get("mark.diff-search-match.active").text()).toBe("const");
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it("展开上下文后保留当前搜索匹配和滚动位置", async () => {
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(
          path,
          revision,
          [
            revision === "base-sha" ? "base 1" : "head 1",
            `${revision} 2`,
            "unchanged 3",
            `${revision} 4`,
            "unchanged 5",
            `${revision} 6`,
            "unchanged 7",
            `${revision} 8`,
          ].join("\n"),
        ),
    );
    const wrapper = await mountViewer(contextDiff, contextProps);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="right"]');
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(search, "unchanged");
    await search.trigger("keydown", { key: "Enter" });

    expect(pane.get(".code-search-result").text()).toBe("2/2");
    const diffScroll = wrapper.get<HTMLElement>(".diff-scroll-region").element;
    diffScroll.scrollTop = 137;

    const secondHunkHeader = wrapper.findAll(".controlled-side-left .controlled-hunk-header")[1];
    await secondHunkHeader.get(".context-gap-button").trigger("click");
    await flushPromises();

    const activeLine = wrapper
      .get("mark.diff-search-match.active")
      .element.closest<HTMLElement>(".controlled-line");
    expect(pane.get(".code-search-result").text()).toBe("3/3");
    expect(activeLine?.dataset.side).toBe("right");
    expect(activeLine?.dataset.line).toBe("7");
    expect(diffScroll.scrollTop).toBe(137);
  });

  it("Vue 更新清除代码 DOM 高亮后会恢复搜索结果和当前索引", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="right"]');
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(search, "const");
    await pane.get('[aria-label="右侧下一个匹配项"]').trigger("click");
    expect(pane.get(".code-search-result").text()).toBe("2/2");

    wrapper.findAll(".controlled-side-right .controlled-code").forEach((code) => {
      code.element.replaceChildren(document.createTextNode(code.element.textContent ?? ""));
    });
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);
    expect(pane.get(".code-search-result").text()).toBe("2/2");

    await wrapper.setProps({ readOnly: true });
    await flushPromises();

    expect(wrapper.findAll(".controlled-side-right mark.diff-search-match")).toHaveLength(2);
    expect(pane.get(".code-search-result").text()).toBe("2/2");
    expect(wrapper.get("mark.diff-search-match.active").text()).toBe("const");

    await pane.get('[aria-label="右侧下一个匹配项"]').trigger("click");
    expect(pane.get(".code-search-result").text()).toBe("1/2");
  });

  it("支持区分大小写、全词和正则表达式搜索", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="right"]');
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    const caseSensitive = pane.get('[aria-label="右侧 区分大小写"]');
    const wholeWord = pane.get('[aria-label="右侧 全词匹配"]');
    const regex = pane.get('[aria-label="右侧 使用正则表达式"]');

    await setCodeSearchQuery(search, "<NEW>");
    expect(pane.get(".code-search-result").text()).toBe("1/1");

    await caseSensitive.trigger("click");
    await flushPromises();
    expect(caseSensitive.attributes("aria-pressed")).toBe("true");
    expect(pane.get(".code-search-result").text()).toBe("无结果");
    await setCodeSearchQuery(search, "<new>");
    expect(pane.get(".code-search-result").text()).toBe("1/1");

    await caseSensitive.trigger("click");
    await setCodeSearchQuery(search, "stat");
    expect(pane.get(".code-search-result").text()).toBe("1/1");
    await wholeWord.trigger("click");
    await flushPromises();
    expect(wholeWord.attributes("aria-pressed")).toBe("true");
    expect(pane.get(".code-search-result").text()).toBe("无结果");
    await setCodeSearchQuery(search, "state");
    expect(pane.get(".code-search-result").text()).toBe("1/1");

    await wholeWord.trigger("click");
    await regex.trigger("click");
    await setCodeSearchQuery(search, "(?:const )+(state|value)");
    expect(regex.attributes("aria-pressed")).toBe("true");
    expect(pane.get(".code-search-result").text()).toBe("1/2");

    await setCodeSearchQuery(search, "(a+)+$");
    expect(pane.get(".code-search-result").text()).toBe("正则表达式包含可能导致卡顿的重复结构");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);

    await setCodeSearchQuery(search, "(a|aa)+$");
    expect(pane.get(".code-search-result").text()).toBe("正则表达式包含可能导致卡顿的重复结构");

    await setCodeSearchQuery(search, "a*a*a*a*a*a*a*a*b");
    expect(pane.get(".code-search-result").text()).toBe("正则表达式包含可能导致卡顿的重复结构");

    for (const dangerousPattern of ["\\d*\\d*\\d*X", "[ab]*[ab]*[ab]*c"]) {
      await setCodeSearchQuery(search, dangerousPattern);
      expect(pane.get(".code-search-result").text()).toBe("正则表达式包含可能导致卡顿的重复结构");
    }

    for (const allowedPattern of ["a*b*", "a+b+c+", "a{2}a{2}", "foo.*bar"]) {
      await setCodeSearchQuery(search, allowedPattern);
      expect(pane.get(".code-search-result").text()).not.toContain("重复结构");
    }

    await setCodeSearchQuery(search, "(state)\\1");
    expect(pane.get(".code-search-result").text()).toBe("正则表达式不支持反向引用");

    await setCodeSearchQuery(search, "a".repeat(257));
    expect(pane.get(".code-search-result").text()).toBe("正则表达式过长（最多 256 个字符）");

    await setCodeSearchQuery(search, "[");
    expect(search.attributes("aria-invalid")).toBe("true");
    expect(pane.get(".code-search-result").text()).toBe("正则表达式无效");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);
    expect(pane.get('[aria-label="右侧下一个匹配项"]').attributes()).toHaveProperty("disabled");

    setAppLocale("en-US");
    await setCodeSearchQuery(search, "(a+)+$");
    expect(pane.get(".code-search-result").text()).toBe(
      "The regular expression contains a repeated pattern that may freeze search",
    );
  });

  it("正则模式拒绝搜索超长代码行", async () => {
    const longContent = "a".repeat(20_001);
    const longLineDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "src/generated.ts",
          status: "added",
          patch: "",
          additions: 1,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "src/generated.ts",
          old_path: null,
          new_path: "src/generated.ts",
          status: "added",
          additions: 1,
          deletions: 0,
          content_kind: "text",
          patch: "",
          message: null,
          hunks: [
            {
              header: "@@ -0,0 +1 @@",
              old_start: 0,
              old_count: 0,
              new_start: 1,
              new_count: 1,
              section_header: null,
              lines: [{ kind: "addition", content: longContent, old_line: null, new_line: 1 }],
            },
          ],
        },
      ],
    };
    const wrapper = await mountViewer(longLineDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="right"]');
    await pane.get('[aria-label="右侧 使用正则表达式"]').trigger("click");
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(search, "a+$");

    expect(search.attributes("aria-invalid")).toBe("true");
    expect(pane.get(".code-search-result").text()).toContain("超长代码行");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);
  });

  it("无匹配时禁用导航，Escape 只关闭当前侧搜索并清除其高亮", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const pane = wrapper.get('.code-search-pane[data-side="left"]');
    const search = pane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(search, "missing-value");

    expect(pane.get(".code-search-result").text()).toBe("无结果");
    expect(pane.get('[aria-label="左侧下一个匹配项"]').attributes()).toHaveProperty("disabled");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);

    await setCodeSearchQuery(search, "const");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(true);
    await search.trigger("keydown", { key: "Escape" });

    expect(wrapper.find('.code-search-pane[data-side="left"]').exists()).toBe(false);
    expect(wrapper.find('.code-search-pane[data-side="right"]').exists()).toBe(true);
    expect(wrapper.findAll(".controlled-side-left mark.diff-search-match")).toHaveLength(0);
  });

  it("⌘/Ctrl+F 与放大镜使用相同的代码侧回退，且不接管其他输入控件", async () => {
    const wrapper = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff: standardizedDiff },
    });
    await flushPromises();

    const outsideFind = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(outsideFind);
    await flushPromises();

    expect(outsideFind.defaultPrevented).toBe(true);
    expect(wrapper.findAll(".code-search-pane")).toHaveLength(2);
    await wrapper.get('[aria-label="查找代码"]').trigger("click");

    await wrapper.get(".controlled-side-left").trigger("pointerenter");
    const metaFind = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(metaFind);
    await flushPromises();

    expect(metaFind.defaultPrevented).toBe(true);
    expect(wrapper.find(".diff-search-bar").exists()).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('.code-search-pane[data-side="left"] .code-search-input').element,
    );

    await wrapper.get('[aria-label="关闭左侧查找"]').trigger("click");
    const externalInput = document.createElement("input");
    document.body.append(externalInput);
    externalInput.focus();
    const inputFind = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    externalInput.dispatchEvent(inputFind);
    await flushPromises();

    expect(inputFind.defaultPrevented).toBe(false);
    expect(wrapper.find(".diff-search-bar").exists()).toBe(false);
    externalInput.remove();

    await wrapper.get(".controlled-side-right").trigger("pointerenter");
    const ctrlFind = new KeyboardEvent("keydown", {
      key: "F",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ctrlFind);
    await flushPromises();
    expect(ctrlFind.defaultPrevented).toBe(true);
    expect(wrapper.find(".diff-search-bar").exists()).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('.code-search-pane[data-side="right"] .code-search-input').element,
    );

    await wrapper.get(".controlled-side-right").trigger("pointerleave");
    await wrapper.get('[aria-label="关闭右侧查找"]').trigger("click");
    const afterLeaveFind = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(afterLeaveFind);
    await flushPromises();
    expect(afterLeaveFind.defaultPrevented).toBe(true);
    expect(wrapper.find('.code-search-pane[data-side="left"]').exists()).toBe(false);
    expect(wrapper.find('.code-search-pane[data-side="right"]').exists()).toBe(true);

    wrapper.unmount();
    const afterUnmount = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      cancelable: true,
    });
    document.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("可单独关闭左侧查找并保留右侧结果", async () => {
    const wrapper = await mountViewer(standardizedDiff);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const leftPane = wrapper.get('.code-search-pane[data-side="left"]');
    const rightPane = wrapper.get('.code-search-pane[data-side="right"]');
    await setCodeSearchQuery(leftPane.get<HTMLInputElement>('input[type="search"]'), "const");
    await setCodeSearchQuery(rightPane.get<HTMLInputElement>('input[type="search"]'), "const");

    expect(wrapper.findAll("mark.diff-search-match")).toHaveLength(4);
    await leftPane.get('[aria-label="关闭左侧查找"]').trigger("click");

    expect(wrapper.find('.code-search-pane[data-side="left"]').exists()).toBe(false);
    expect(wrapper.find('.code-search-pane[data-side="right"]').exists()).toBe(true);
    expect(wrapper.findAll(".controlled-side-left mark.diff-search-match")).toHaveLength(0);
    expect(wrapper.findAll(".controlled-side-right mark.diff-search-match")).toHaveLength(2);

    await wrapper.get('[aria-label="关闭右侧查找"]').trigger("click");
    expect(wrapper.find(".diff-search-bar").exists()).toBe(false);
    expect(wrapper.findAll("mark.diff-search-match")).toHaveLength(0);
  });

  it("在 diff2html 回退视图中按鼠标所在代码侧打开查找", async () => {
    const wrapper = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff },
    });
    await flushPromises();

    const legacyRightSide = wrapper.findAll<HTMLElement>(".d2h-file-side-diff")[1];
    if (!legacyRightSide) throw new Error("未找到回退视图的右侧代码面板");
    await legacyRightSide.trigger("pointermove");

    const find = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(find);
    await flushPromises();

    expect(find.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('.code-search-pane[data-side="right"] .code-search-input').element,
    );
    wrapper.unmount();
  });

  it("按 AI 建议选中文件并优先定位变更后的行", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      locationRequest: { id: 1, path: "tests/App.spec.ts", line: 1 },
    });

    expect(wrapper.get(".selected-file-name").text()).toBe("tests/App.spec.ts");
    const highlighted = wrapper.get(".controlled-side-right .diff-location-highlight");
    expect(highlighted.attributes("data-line")).toBe("1");
    expect(wrapper.find(".controlled-side-left .diff-location-highlight").exists()).toBe(false);
    expect(wrapper.emitted("locationResult")?.at(-1)).toEqual([
      { id: 1, success: true, message: null },
    ]);
  });

  it("定位评审评论时遵循显式 left/right side", async () => {
    const left = await mountViewer(standardizedDiff, {
      locationRequest: { id: 9, path: "src/components/App.ts", line: 2, side: "left" },
    });

    expect(left.get(".controlled-side-left .diff-location-highlight").attributes("data-line")).toBe(
      "2",
    );
    expect(left.find(".controlled-side-right .diff-location-highlight").exists()).toBe(false);

    const right = await mountViewer(standardizedDiff, {
      locationRequest: { id: 10, path: "src/components/App.ts", line: 2, side: "right" },
    });
    expect(
      right.get(".controlled-side-right .diff-location-highlight").attributes("data-line"),
    ).toBe("2");
    expect(right.find(".controlled-side-left .diff-location-highlight").exists()).toBe(false);
  });

  it("定位 AI 建议时只滚动 Diff 内部容器", async () => {
    const wrapper = await mountViewer(standardizedDiff);
    const scrollRegion = wrapper.get<HTMLElement>(".diff-scroll-region");
    const targetLine = wrapper.get<HTMLElement>(
      '.controlled-side-right .controlled-line[data-line="2"]',
    );
    const outerScroll = vi.fn();

    Object.defineProperty(targetLine.element, "scrollIntoView", {
      configurable: true,
      value: outerScroll,
    });
    Object.defineProperty(scrollRegion.element, "clientHeight", {
      configurable: true,
      value: 400,
    });
    scrollRegion.element.scrollTop = 40;
    scrollRegion.element.getBoundingClientRect = () => ({ top: 100, height: 400 }) as DOMRect;
    targetLine.element.getBoundingClientRect = () => ({ top: 300, height: 20 }) as DOMRect;

    await wrapper.setProps({
      locationRequest: { id: 8, path: "src/components/App.ts", line: 2 },
    });
    await flushPromises();

    expect(outerScroll).not.toHaveBeenCalled();
    expect(scrollRegion.element.scrollTop).toBe(50);
    expect(wrapper.emitted("locationResult")?.at(-1)).toEqual([
      { id: 8, success: true, message: null },
    ]);
  });

  it("变更后行不存在时回退定位变更前的删除行", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      locationRequest: { id: 2, path: "src/components/App.ts", line: 2 },
    });

    expect(
      wrapper.get(".controlled-side-right .diff-location-highlight").attributes("data-line"),
    ).toBe("2");

    const deletionOnly: DiffResult = {
      ...standardizedDiff,
      patches: [
        {
          ...standardizedDiff.patches[0],
          hunks: [
            {
              ...standardizedDiff.patches[0].hunks[0],
              lines: [{ kind: "deletion", content: "removed", old_line: 7, new_line: null }],
            },
          ],
        },
      ],
      files: [standardizedDiff.files[0]],
    };
    const deletionWrapper = await mountViewer(deletionOnly, {
      locationRequest: { id: 3, path: "src/components/App.ts", line: 7 },
    });

    expect(
      deletionWrapper.get(".controlled-side-left .diff-location-highlight").attributes("data-line"),
    ).toBe("7");
    expect(deletionWrapper.emitted("locationResult")?.at(-1)).toEqual([
      { id: 3, success: true, message: null },
    ]);
  });

  it("重命名文件可通过旧路径定位到新文件", async () => {
    const renamedDiff: DiffResult = {
      ...standardizedDiff,
      files: [{ ...standardizedDiff.files[0], filename: "src/new-name.ts", status: "renamed" }],
      patches: [
        {
          ...standardizedDiff.patches[0],
          filename: "src/new-name.ts",
          old_path: "src/old-name.ts",
          new_path: "src/new-name.ts",
          status: "renamed",
        },
      ],
    };
    const wrapper = await mountViewer(renamedDiff, {
      locationRequest: { id: 4, path: "src/old-name.ts", line: 2 },
    });

    expect(wrapper.get(".selected-file-name").text()).toBe("src/new-name.ts");
    expect(
      wrapper.get(".controlled-side-left .diff-location-highlight").attributes("data-line"),
    ).toBe("2");

    await wrapper.setProps({
      locationRequest: { id: 5, path: "src/new-name.ts", line: 2 },
    });
    await flushPromises();

    expect(
      wrapper.get(".controlled-side-right .diff-location-highlight").attributes("data-line"),
    ).toBe("2");
  });

  it("文件或行号失效时返回明确失败且不残留高亮", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      locationRequest: { id: 5, path: "src/missing.ts", line: 9 },
    });

    expect(wrapper.emitted("locationResult")?.at(-1)).toEqual([
      expect.objectContaining({
        id: 5,
        success: false,
        message: expect.stringContaining("找不到文件"),
      }),
    ]);

    await wrapper.setProps({
      locationRequest: { id: 6, path: "src/components/App.ts", line: 999 },
    });
    await flushPromises();

    expect(wrapper.emitted("locationResult")?.at(-1)).toEqual([
      expect.objectContaining({
        id: 6,
        success: false,
        message: expect.stringContaining("找不到变更行"),
      }),
    ]);
    expect(wrapper.find(".diff-location-highlight").exists()).toBe(false);
  });

  it("没有行号时只选中文件并返回成功", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      locationRequest: { id: 7, path: "tests/App.spec.ts", line: null },
    });

    expect(wrapper.get(".selected-file-name").text()).toBe("tests/App.spec.ts");
    expect(wrapper.find(".diff-location-highlight").exists()).toBe(false);
    expect(wrapper.emitted("locationResult")?.at(-1)).toEqual([
      { id: 7, success: true, message: null },
    ]);
  });

  it("对二进制或不可用 patch 显示稳定提示而不是空白", async () => {
    const binaryDiff: DiffResult = {
      ...standardizedDiff,
      files: [standardizedDiff.files[0]],
      patches: [
        {
          ...standardizedDiff.patches[0],
          content_kind: "binary",
          hunks: [],
          message: "二进制文件不提供文本 Diff",
        },
      ],
    };

    const wrapper = await mountViewer(binaryDiff);

    expect(wrapper.get(".controlled-file-message").text()).toContain("二进制文件");
    expect(wrapper.find(".diff-empty").exists()).toBe(false);
  });

  it("SVG 文件默认渲染安全的双侧图像预览，并可切换到代码 Diff", async () => {
    const svgDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "assets/diagram.svg",
          status: "modified",
          patch: "",
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "assets/diagram.svg",
          old_path: "assets/diagram.svg",
          new_path: "assets/diagram.svg",
          status: "modified",
          additions: 1,
          deletions: 1,
          content_kind: "text",
          patch: "",
          message: null,
          hunks: [
            {
              header: "@@ -1 +1 @@",
              old_start: 1,
              old_count: 1,
              new_start: 1,
              new_count: 1,
              section_header: null,
              lines: [
                { kind: "deletion", content: '<rect fill="red" />', old_line: 1, new_line: null },
                { kind: "addition", content: '<rect fill="blue" />', old_line: null, new_line: 1 },
              ],
            },
          ],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(
          path,
          revision,
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${revision === "base-sha" ? "red" : "blue"}"/><script>alert(1)</script></svg>`,
        ),
    );
    const wrapper = await mountViewer(svgDiff, contextProps);

    expect(wrapper.findAll(".media-view-toggle button").map((button) => button.text())).toEqual([
      "代码",
      "预览",
    ]);
    expect(wrapper.findAll(".media-view-toggle button")[1].attributes("aria-pressed")).toBe("true");

    expect(prFileContentMock).toHaveBeenCalledTimes(2);
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "octo",
      "demo",
      "assets/diagram.svg",
      "base-sha",
      { mediaPreview: true },
    );
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "octo",
      "demo",
      "assets/diagram.svg",
      "head-sha",
      { mediaPreview: true },
    );
    expect(wrapper.findAll(".media-preview-panel")).toHaveLength(2);
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
    expect(wrapper.get(".media-preview-image").element.parentElement?.className).toBe(
      "media-preview-stage",
    );
    expect(wrapper.get(".media-preview-image").attributes("src")).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
    expect(wrapper.find(".media-preview-stage script").exists()).toBe(false);
    expect(wrapper.find(".diff-top-scrollbars").exists()).toBe(false);
    expect(wrapper.find(".controlled-side-by-side").exists()).toBe(false);

    await wrapper.findAll(".media-view-toggle button")[0].trigger("click");

    expect(wrapper.find(".controlled-side-by-side").exists()).toBe(true);
    expect(wrapper.find(".media-preview-grid").exists()).toBe(false);
  });

  it("新增的 fork SVG 使用 UTF-8 base64 渲染完整样式内容", async () => {
    const qdrantSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 346.42 400">
  <defs><style>.cls-1 { fill: #9e0d38; }</style></defs>
  <polygon class="cls-1" points="173.21 0 0 100 173.21 400 346.42 100"/>
</svg>`;
    const addedSvgDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "docs/public/icons/database/qdrant.svg",
          status: "added",
          patch: "",
          additions: 5,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "docs/public/icons/database/qdrant.svg",
          old_path: null,
          new_path: "docs/public/icons/database/qdrant.svg",
          status: "added",
          additions: 5,
          deletions: 0,
          content_kind: "text",
          patch: "",
          message: null,
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(path, revision, qdrantSvg),
    );

    const wrapper = await mountViewer(addedSvgDiff, {
      ...contextProps,
      headOwner: "eryajf",
      headRepo: "dbx",
    });

    expect(prFileContentMock).toHaveBeenCalledTimes(1);
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "eryajf",
      "dbx",
      "docs/public/icons/database/qdrant.svg",
      "head-sha",
      { mediaPreview: true },
    );
    expect(wrapper.findAll(".media-preview-panel")).toHaveLength(1);
    const source = wrapper.get(".media-preview-image").attributes("src");
    expect(source).toMatch(/^data:image\/svg\+xml;base64,/);
    const renderedSvg = atob(source!.replace("data:image/svg+xml;base64,", ""));
    expect(renderedSvg).toContain('width="346.42"');
    expect(renderedSvg).toContain('height="400"');
    expect(renderedSvg).toContain(".cls-1");
  });

  it("从代码文件切换到新增 SVG 时触发图片加载且不出现空白预览", async () => {
    const qdrantPath = "docs/public/icons/database/qdrant.svg";
    const mixedDiff: DiffResult = {
      ...standardizedDiff,
      files: [
        ...standardizedDiff.files,
        {
          filename: qdrantPath,
          status: "added",
          patch: "",
          additions: 1,
          deletions: 0,
        },
      ],
      patches: [
        ...standardizedDiff.patches,
        {
          filename: qdrantPath,
          old_path: null,
          new_path: qdrantPath,
          status: "added",
          additions: 1,
          deletions: 0,
          content_kind: "text",
          patch: "",
          message: null,
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(
          path,
          revision,
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        ),
    );
    const wrapper = await mountViewer(mixedDiff, {
      ...contextProps,
      headOwner: "eryajf",
      headRepo: "dbx",
    });

    await wrapper.get(`[data-file-path="${standardizedDiff.files[0].filename}"]`).trigger("click");
    expect(wrapper.find(".media-view-toggle").exists()).toBe(false);
    await wrapper.get(`[data-file-path="${qdrantPath}"]`).trigger("click");
    await flushPromises();

    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "eryajf",
      "dbx",
      qdrantPath,
      "head-sha",
      { mediaPreview: true },
    );
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(1);
    expect(wrapper.find(".media-preview-empty").exists()).toBe(false);
  });

  it("非 UTF-8 编码的 SVG 使用原始 base64 渲染", async () => {
    const encodedSvgDiff: DiffResult = {
      ...standardizedDiff,
      files: [{ ...standardizedDiff.files[0], filename: "assets/encoded.svg" }],
      patches: [
        {
          ...standardizedDiff.patches[0],
          filename: "assets/encoded.svg",
          old_path: "assets/encoded.svg",
          new_path: "assets/encoded.svg",
          content_kind: "binary",
          hunks: [],
          message: "二进制文件不提供文本 Diff",
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        content_base64:
          "//48AHMAdgBnACAAeABtAGwAbgBzAD0AIgBoAHQAdABwADoALwAvAHcAdwB3AC4AdwAzAC4AbwByAGcALwAyADAAMAAwAC8AcwB2AGcAIgAgAHYAaQBlAHcAQgBvAHgAPQAiADAAIAAwACAAMQAgADEAIgA+ADwALwBzAHYAZwA+AA==",
        binary: true,
      }),
    );

    const wrapper = await mountViewer(encodedSvgDiff, contextProps);

    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
    expect(wrapper.get(".media-preview-image").attributes("src")).toBe(
      "data:image/svg+xml;base64,//48AHMAdgBnACAAeABtAGwAbgBzAD0AIgBoAHQAdABwADoALwAvAHcAdwB3AC4AdwAzAC4AbwByAGcALwAyADAAMAAwAC8AcwB2AGcAIgAgAHYAaQBlAHcAQgBvAHgAPQAiADAAIAAwACAAMQAgADEAIgA+ADwALwBzAHYAZwA+AA==",
    );
    expect(wrapper.find(".media-preview-error").exists()).toBe(false);
  });

  it("PNG 等普通二进制图片默认渲染双侧预览", async () => {
    const pngDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "assets/screenshot.png",
          status: "modified",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "assets/screenshot.png",
          old_path: "assets/screenshot.png",
          new_path: "assets/screenshot.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        binary: true,
      }),
    );

    const wrapper = await mountViewer(pngDiff, {
      ...contextProps,
      baseOwner: "upstream",
      baseRepo: "images",
      headOwner: "fork",
      headRepo: "images",
    });

    expect(prFileContentMock).toHaveBeenCalledTimes(2);
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "upstream",
      "images",
      "assets/screenshot.png",
      "base-sha",
      { mediaPreview: true },
    );
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "fork",
      "images",
      "assets/screenshot.png",
      "head-sha",
      { mediaPreview: true },
    );
    expect(wrapper.findAll(".media-preview-panel")).toHaveLength(2);
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
    expect(wrapper.get(".media-preview-image").attributes("src")).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    );
    expect(wrapper.find(".controlled-file-message").exists()).toBe(false);
  });

  it.each([
    ["mp4", "video/mp4"],
    ["webm", "video/webm"],
    ["mov", "video/quicktime"],
    ["ogv", "video/ogg"],
  ])("%s 视频默认使用原生控件安全播放", async (extension, mimeType) => {
    const path = `assets/demo.${extension}`;
    const videoDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: path,
          status: "added",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: path,
          old_path: null,
          new_path: path,
          status: "added",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        requestedPath: string,
        revision: string,
      ) => ({
        ...fileContent(requestedPath, revision, ""),
        content_base64: "AAAAHGZ0eXBtcDQy",
        binary: true,
      }),
    );

    const wrapper = await mountViewer(videoDiff, contextProps);

    expect(prFileContentMock).toHaveBeenCalledWith("github", "octo", "demo", path, "head-sha", {
      mediaPreview: true,
    });
    expect(wrapper.findAll(".media-preview-panel")).toHaveLength(1);
    expect(wrapper.find(".media-preview-image").exists()).toBe(false);
    const video = wrapper.get(".media-preview-video");
    expect(video.attributes("src")).toBe(`data:${mimeType};base64,AAAAHGZ0eXBtcDQy`);
    expect(video.attributes("controls")).toBeDefined();
    expect(video.attributes("playsinline")).toBeDefined();
    expect(video.attributes("preload")).toBe("metadata");
    expect(video.attributes("autoplay")).toBeUndefined();
    expect(video.attributes("aria-label")).toContain(path);
  });

  it("从文本文件第一次切换到图片时立即加载并展示预览", async () => {
    const mixedDiff: DiffResult = {
      ...standardizedDiff,
      files: [
        { ...standardizedDiff.files[0], filename: "aaa/source.ts" },
        {
          filename: "zzz/screenshot.png",
          status: "modified",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patches: [
        {
          ...standardizedDiff.patches[0],
          filename: "aaa/source.ts",
          old_path: "aaa/source.ts",
          new_path: "aaa/source.ts",
        },
        {
          filename: "zzz/screenshot.png",
          old_path: "zzz/screenshot.png",
          new_path: "zzz/screenshot.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        binary: true,
      }),
    );
    const wrapper = await mountViewer(mixedDiff, contextProps);

    expect(wrapper.get(".selected-file-name").text()).toBe("aaa/source.ts");
    expect(prFileContentMock).not.toHaveBeenCalled();

    const imageRow = wrapper
      .findAll(".tree-row[data-file-path]")
      .find((row) => row.attributes("data-file-path") === "zzz/screenshot.png");
    expect(imageRow).toBeDefined();
    await imageRow!.trigger("click");
    await flushPromises();

    expect(wrapper.get(".selected-file-name").text()).toBe("zzz/screenshot.png");
    expect(prFileContentMock).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
  });

  it("首次自动预览失败后点击当前图片会重新加载", async () => {
    const imageDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "assets/screenshot.png",
          status: "modified",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "assets/screenshot.png",
          old_path: "assets/screenshot.png",
          new_path: "assets/screenshot.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementation(
        async (
          _platform: Platform,
          _owner: string,
          _repo: string,
          path: string,
          revision: string,
        ) => ({
          ...fileContent(path, revision, ""),
          content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
          binary: true,
        }),
      );
    const wrapper = await mountViewer(imageDiff, contextProps);

    expect(wrapper.findAll(".media-preview-error")).toHaveLength(2);
    expect(wrapper.find(".media-preview-image").exists()).toBe(false);

    await wrapper.get('.tree-row[data-file-path="assets/screenshot.png"]').trigger("click");
    await flushPromises();

    expect(prFileContentMock).toHaveBeenCalledTimes(4);
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
  });

  it("切换图片时重建节点并忽略上一张图片迟到的解码错误", async () => {
    const imageDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "assets/first.png",
          status: "added",
          patch: "",
          additions: 0,
          deletions: 0,
        },
        {
          filename: "assets/second.png",
          status: "added",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "assets/first.png",
          old_path: null,
          new_path: "assets/first.png",
          status: "added",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
        {
          filename: "assets/second.png",
          old_path: null,
          new_path: "assets/second.png",
          status: "added",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        content_base64: path.includes("first") ? "Zmlyc3Q=" : "c2Vjb25k",
        binary: true,
      }),
    );
    const wrapper = await mountViewer(imageDiff, contextProps);
    const firstImage = wrapper.get(".media-preview-image");
    const firstElement = firstImage.element;

    await wrapper.get('.tree-row[data-file-path="assets/second.png"]').trigger("click");
    await flushPromises();

    const secondImage = wrapper.get(".media-preview-image");
    expect(secondImage.element).not.toBe(firstElement);
    expect(secondImage.attributes("src")).toContain("c2Vjb25k");

    await firstImage.trigger("error");
    await flushPromises();

    expect(wrapper.get(".media-preview-image").attributes("src")).toContain("c2Vjb25k");
    expect(wrapper.find(".media-preview-error").exists()).toBe(false);
  });

  it("图片请求未完成时切走再切回同一文件会启动新请求并展示预览", async () => {
    const mixedDiff: DiffResult = {
      ...standardizedDiff,
      files: [
        { ...standardizedDiff.files[0], filename: "aaa/source.ts" },
        {
          filename: "zzz/screenshot.png",
          status: "modified",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patches: [
        {
          ...standardizedDiff.patches[0],
          filename: "aaa/source.ts",
          old_path: "aaa/source.ts",
          new_path: "aaa/source.ts",
        },
        {
          filename: "zzz/screenshot.png",
          old_path: "zzz/screenshot.png",
          new_path: "zzz/screenshot.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    const pending: Array<(content: PrFileContent) => void> = [];
    prFileContentMock.mockImplementation(
      (_platform: Platform, _owner: string, _repo: string, _path: string, _revision: string) =>
        new Promise<PrFileContent>((resolve) => {
          pending.push(resolve);
        }),
    );
    const wrapper = await mountViewer(mixedDiff, contextProps);
    const rowFor = (path: string) =>
      wrapper
        .findAll(".tree-row[data-file-path]")
        .find((row) => row.attributes("data-file-path") === path)!;

    await rowFor("zzz/screenshot.png").trigger("click");
    await flushPromises();
    expect(prFileContentMock).toHaveBeenCalledTimes(2);

    await rowFor("aaa/source.ts").trigger("click");
    await rowFor("zzz/screenshot.png").trigger("click");
    await flushPromises();
    expect(prFileContentMock).toHaveBeenCalledTimes(4);

    for (const resolve of pending.slice(2)) {
      resolve({
        ...fileContent("zzz/screenshot.png", "head-sha", ""),
        content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        binary: true,
      });
    }
    await flushPromises();

    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);

    for (const resolve of pending.slice(0, 2)) {
      resolve({
        ...fileContent("zzz/screenshot.png", "base-sha", ""),
        content_base64: "b2xkLXJlcXVlc3Q=",
        binary: true,
      });
    }
    await flushPromises();

    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
    expect(wrapper.get(".media-preview-image").attributes("src")).toContain(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    );
  });

  it("组件挂载后首次收到图片 Diff 时立即展示预览", async () => {
    const imageDiff: DiffResult = {
      diff: "",
      files: [
        {
          filename: "assets/screenshot.png",
          status: "modified",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "assets/screenshot.png",
          old_path: "assets/screenshot.png",
          new_path: "assets/screenshot.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          content_kind: "binary",
          patch: "",
          message: "二进制文件不提供文本 Diff",
          hunks: [],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        binary: true,
      }),
    );
    const wrapper = mount(DiffViewer, { props: { diff: null, ...contextProps } });

    await wrapper.setProps({ diff: imageDiff });
    await flushPromises();

    expect(prFileContentMock).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll(".media-preview-image")).toHaveLength(2);
  });

  it("SVG 内容被截断时显示可重试错误并保留代码 Diff", async () => {
    const svgDiff: DiffResult = {
      ...standardizedDiff,
      files: [{ ...standardizedDiff.files[0], filename: "assets/large.svg" }],
      patches: [
        {
          ...standardizedDiff.patches[0],
          filename: "assets/large.svg",
          old_path: "assets/large.svg",
          new_path: "assets/large.svg",
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (
        _platform: Platform,
        _owner: string,
        _repo: string,
        path: string,
        revision: string,
      ) => ({
        ...fileContent(path, revision, ""),
        truncated: true,
      }),
    );
    const wrapper = await mountViewer(svgDiff, contextProps);

    expect(wrapper.findAll(".media-preview-error")).toHaveLength(2);
    expect(wrapper.get(".media-preview-error").text()).toContain("媒体文件过大");
    expect(wrapper.find(".media-preview-image").exists()).toBe(false);

    await wrapper.findAll(".media-view-toggle button")[0].trigger("click");

    expect(wrapper.find(".controlled-side-by-side").exists()).toBe(true);
  });

  it("纯重命名没有文本 hunk 时不显示上下文展开操作", async () => {
    const metadataOnlyRename: DiffResult = {
      diff: "",
      files: [
        {
          filename: "src/new-name.ts",
          status: "renamed",
          patch: "",
          additions: 0,
          deletions: 0,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "src/new-name.ts",
          old_path: "src/old-name.ts",
          new_path: "src/new-name.ts",
          status: "renamed",
          additions: 0,
          deletions: 0,
          content_kind: "metadata_only",
          patch: "",
          message: "该文件仅包含重命名、权限或其他元数据变更",
          hunks: [],
        },
      ],
    };

    const wrapper = await mountViewer(metadataOnlyRename, contextProps);

    expect(wrapper.get(".controlled-file-message").text()).toContain("仅包含重命名");
    expect(wrapper.find(".context-toolbar-button").exists()).toBe(false);
    expect(wrapper.find(".context-gap-button").exists()).toBe(false);
    expect(prFileContentMock).not.toHaveBeenCalled();
  });

  it("从行号槽按方向展开单个上下文，并按 base/head 路径请求文件内容", async () => {
    mockContextFiles();
    const wrapper = await mountViewer(contextDiff, contextProps);
    const buttons = wrapper.findAll(".context-gap-button");
    const leftHunkHeaders = wrapper.findAll(".controlled-side-left .controlled-hunk-header");

    expect(leftHunkHeaders).toHaveLength(2);
    expect(leftHunkHeaders[0].findAll(".context-gap-button")).toHaveLength(1);
    expect(leftHunkHeaders[1].findAll(".context-gap-button")).toHaveLength(2);
    expect(
      wrapper.findAll(".controlled-side-right .controlled-hunk-header .context-gap-placeholder"),
    ).toHaveLength(2);
    expect(buttons).toHaveLength(3);
    expect(buttons[0].attributes("aria-label")).toBe("展开上方未变更上下文（20 行）");
    expect(buttons[0].text()).toBe("↑");
    expect(buttons[1].attributes("aria-label")).toBe("向上展开未变更上下文（20 行）");
    expect(buttons[1].text()).toBe("↑");
    expect(buttons[2].attributes("aria-label")).toBe("向下展开未变更上下文（20 行）");
    expect(buttons[2].text()).toBe("↓");

    await buttons[0].trigger("click");
    await flushPromises();

    expect(prFileContentMock).toHaveBeenCalledTimes(2);
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "octo",
      "demo",
      "src/context.old.ts",
      "base-sha",
    );
    expect(prFileContentMock).toHaveBeenCalledWith(
      "github",
      "octo",
      "demo",
      "src/context.ts",
      "head-sha",
    );
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(4);
    expect(wrapper.get(".controlled-side-left").text()).toContain("base 1");
    expect(wrapper.get(".controlled-side-right").text()).toContain("<script>alert(1)</script>");
    expect(wrapper.find(".controlled-side-right script").exists()).toBe(false);
    expect(wrapper.get('[aria-label="展开下方未变更上下文（20 行）"]').text()).toBe("↓");
  });

  it("每次点击只展开 20 行，直到该方向的上下文全部可见", async () => {
    const largeContextDiff: DiffResult = {
      ...contextDiff,
      patches: [
        {
          ...contextDiff.patches[0],
          hunks: [
            {
              header: "@@ -51 +51 @@",
              old_start: 51,
              old_count: 1,
              new_start: 51,
              new_count: 1,
              section_header: null,
              lines: [{ kind: "context", content: "changed 51", old_line: 51, new_line: 51 }],
            },
          ],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(
          path,
          revision,
          Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n"),
        ),
    );
    const wrapper = await mountViewer(largeContextDiff, contextProps);
    const topLabel = '[aria-label="展开上方未变更上下文（20 行）"]';

    await wrapper.get(topLabel).trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(40);
    expect(wrapper.find(topLabel).exists()).toBe(true);

    await wrapper.get(topLabel).trigger("click");
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(80);
    expect(wrapper.find(topLabel).exists()).toBe(true);

    await wrapper.get(topLabel).trigger("click");
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(100);
    expect(wrapper.find(topLabel).exists()).toBe(false);
    expect(wrapper.get(".controlled-side-left").text()).toContain("line 1");
    expect(wrapper.get(".controlled-side-right").text()).toContain("line 50");
  });

  it("文件 patch 已覆盖全文时加载后移除无效的展开操作", async () => {
    const fullFileDiff: DiffResult = {
      ...contextDiff,
      patches: [
        {
          ...contextDiff.patches[0],
          hunks: [
            {
              header: "@@ -1,2 +1,2 @@",
              old_start: 1,
              old_count: 2,
              new_start: 1,
              new_count: 2,
              section_header: null,
              lines: [
                { kind: "context", content: "line 1", old_line: 1, new_line: 1 },
                { kind: "context", content: "line 2", old_line: 2, new_line: 2 },
              ],
            },
          ],
        },
      ],
    };
    prFileContentMock.mockImplementation(
      async (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        fileContent(path, revision, "line 1\nline 2"),
    );
    const wrapper = await mountViewer(fullFileDiff, contextProps);

    await wrapper.get(".context-toolbar-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".context-toolbar-button").exists()).toBe(false);
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(0);
    expect(wrapper.findAll(".controlled-hunk")).toHaveLength(2);
  });

  it("工具栏可以展开和收起全部上下文，且不会移除原始 hunk", async () => {
    mockContextFiles();
    const wrapper = await mountViewer(contextDiff, contextProps);

    expect(wrapper.findAll(".context-toolbar-button")).toHaveLength(1);
    expect(wrapper.get(".context-toolbar-button").text()).toBe("展开全部上下文");

    await wrapper.get(".context-toolbar-button").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(12);
    expect(wrapper.findAll(".context-gap-button")).toHaveLength(0);
    expect(wrapper.findAll(".controlled-hunk")).toHaveLength(4);
    expect(wrapper.findAll(".context-toolbar-button")).toHaveLength(1);
    expect(wrapper.get(".context-toolbar-button").text()).toBe("收起全部上下文");

    await wrapper.get(".context-toolbar-button").trigger("click");

    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(0);
    expect(wrapper.findAll(".context-gap-button")).toHaveLength(4);
    expect(wrapper.findAll(".controlled-hunk")).toHaveLength(4);
    expect(wrapper.findAll(".context-toolbar-button")).toHaveLength(1);
    expect(wrapper.get(".context-toolbar-button").text()).toBe("展开全部上下文");
  });

  it.each([
    { response: { truncated: true, binary: false }, message: "文件过大" },
    { response: { truncated: false, binary: true }, message: "二进制文件" },
  ])("文件内容不可展开时保留原 Diff：$message", async ({ response, message }) => {
    mockContextFiles(response);
    const wrapper = await mountViewer(contextDiff, contextProps);

    await wrapper.get(".context-gap-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".context-load-error").text()).toContain(message);
    expect(wrapper.findAll(".context-load-error")).toHaveLength(1);
    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(0);
    expect(wrapper.findAll(".controlled-hunk")).toHaveLength(4);
  });

  it("文件内容请求失败时显示一次错误且不白屏", async () => {
    prFileContentMock.mockRejectedValue(new Error("网络失败"));
    const wrapper = await mountViewer(contextDiff, contextProps);

    await wrapper.get(".context-gap-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".context-load-error").text()).toContain("网络失败");
    expect(wrapper.findAll(".context-load-error")).toHaveLength(1);
    expect(wrapper.findAll(".controlled-hunk")).toHaveLength(4);
    expect(wrapper.findAll(".context-gap-button")).toHaveLength(3);
  });

  it.each([
    {
      status: "added" as const,
      oldPath: null,
      newPath: "src/new.ts",
      baseSha: "",
      headSha: "head-sha",
      expectedPath: "src/new.ts",
      expectedRevision: "head-sha",
      contentSide: "right",
    },
    {
      status: "removed" as const,
      oldPath: "src/old.ts",
      newPath: null,
      baseSha: "base-sha",
      headSha: "",
      expectedPath: "src/old.ts",
      expectedRevision: "base-sha",
      contentSide: "left",
    },
  ])(
    "$status 文件只请求存在的一侧，且不会生成虚假的 0 行上下文",
    async ({
      status,
      oldPath,
      newPath,
      baseSha,
      headSha,
      expectedPath,
      expectedRevision,
      contentSide,
    }) => {
      const oneSidedDiff: DiffResult = {
        diff: "",
        files: [
          {
            filename: expectedPath,
            status,
            patch: "",
            additions: status === "added" ? 1 : 0,
            deletions: status === "removed" ? 1 : 0,
          },
        ],
        patch_schema_version: 1,
        patches: [
          {
            filename: expectedPath,
            old_path: oldPath,
            new_path: newPath,
            status,
            additions: status === "added" ? 1 : 0,
            deletions: status === "removed" ? 1 : 0,
            content_kind: "text",
            patch: "",
            message: null,
            hunks: [
              {
                header: status === "added" ? "@@ -0,0 +1 @@" : "@@ -1 +0,0 @@",
                old_start: status === "added" ? 0 : 1,
                old_count: status === "added" ? 0 : 1,
                new_start: status === "added" ? 1 : 0,
                new_count: status === "added" ? 1 : 0,
                section_header: null,
                lines: [
                  {
                    kind: status === "added" ? "addition" : "deletion",
                    content: "changed",
                    old_line: status === "removed" ? 1 : null,
                    new_line: status === "added" ? 1 : null,
                  },
                ],
              },
            ],
          },
        ],
      };
      prFileContentMock.mockResolvedValue(
        fileContent(expectedPath, expectedRevision, "changed\ntrailing"),
      );
      const wrapper = await mountViewer(oneSidedDiff, {
        ...contextProps,
        baseSha,
        headSha,
      });

      await wrapper.get(".context-toolbar-button").trigger("click");
      await flushPromises();

      expect(prFileContentMock).toHaveBeenCalledTimes(1);
      expect(prFileContentMock).toHaveBeenCalledWith(
        "github",
        "octo",
        "demo",
        expectedPath,
        expectedRevision,
      );
      expect(wrapper.get(`.controlled-side-${contentSide}`).text()).toContain("trailing");
      expect(wrapper.findAll('[data-line="0"]')).toHaveLength(0);
    },
  );

  it("切换 revision 后丢弃迟到的旧文件内容响应", async () => {
    const resolvers: Array<(value: PrFileContent) => void> = [];
    prFileContentMock.mockImplementation(
      (_platform: Platform, _owner: string, _repo: string, path: string, revision: string) =>
        new Promise<PrFileContent>((resolve) => {
          resolvers.push((value) => resolve({ ...value, path, revision }));
        }),
    );
    const wrapper = await mountViewer(contextDiff, contextProps);

    void wrapper.get(".context-gap-button").trigger("click");
    await flushPromises();
    expect(resolvers).toHaveLength(2);

    await wrapper.setProps({ baseSha: "new-base", headSha: "new-head" });
    resolvers[0](fileContent("src/context.old.ts", "base-sha", "stale base"));
    resolvers[1](fileContent("src/context.ts", "head-sha", "stale head"));
    await flushPromises();

    expect(wrapper.findAll(".controlled-context-line")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("stale base");
    expect(wrapper.text()).not.toContain("stale head");
    expect(wrapper.find(".context-load-error").exists()).toBe(false);
  });
});

describe("DiffViewer 文件树", () => {
  beforeEach(() => {
    storage.clear();
    reviewViewedFilesListMock.mockReset();
    reviewFileSetViewedMock.mockReset();
    reviewViewedFilesListMock.mockResolvedValue([]);
    reviewFileSetViewedMock.mockResolvedValue(undefined);
    setActivePinia(createPinia());
  });

  it("按目录层级展示变更文件和统计", async () => {
    const wrapper = await mountViewer();

    expect(wrapper.get('[role="tree"]').text()).toContain("src");
    expect(wrapper.get('[role="tree"]').text()).toContain("components");
    expect(wrapper.get('[data-file-path="src/components/App.ts"]').text()).toContain("App.ts");
    expect(
      wrapper.get('[data-file-path="src/components/App.ts"] .tree-label').attributes("title"),
    ).toContain("修改文件");
    expect(
      wrapper.get('[data-file-path="tests/App.spec.ts"] .tree-label').attributes("title"),
    ).toContain("新增文件");
    expect(wrapper.get(".navigator-header").text()).toContain("+2");
    expect(wrapper.get(".navigator-header").text()).toContain("-1");
  });

  it("没有 Diff 内容时仍渲染 scope 插槽", async () => {
    // 变更范围控件挂在这个插槽上。插槽必须位于 hasDiffContent 判断之外，
    // 否则 compare 加载中、失败或结果为空时控件会跟着消失，
    // 用户就没有入口切回整体 Diff。
    const wrapper = mount(DiffViewer, {
      props: { diff: null },
      slots: { scope: '<div data-testid="scope-slot">变更范围</div>' },
    });
    await flushPromises();

    expect(wrapper.find(".diff-empty").exists()).toBe(true);
    expect(wrapper.get('[data-testid="scope-slot"]').text()).toBe("变更范围");
  });

  it("有 Diff 内容时 scope 插槽渲染在工作区之前", async () => {
    const wrapper = mount(DiffViewer, {
      props: { diff: standardizedDiff },
      slots: { scope: '<div data-testid="scope-slot">变更范围</div>' },
    });
    await flushPromises();

    const slot = wrapper.get('[data-testid="scope-slot"]');
    // 插槽是 Diff 卡片的兄弟节点而不是其内部元素，才能在卡片消失时留存。
    expect(slot.element.parentElement?.classList.contains("diff-viewer-wrapper")).toBe(true);
    expect(
      slot.element.compareDocumentPosition(wrapper.get(".diff-workspace").element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("只读 Diff 不参与已查看进度，也不上报评审进度", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "range-head",
      readOnly: true,
    });

    expect(wrapper.find(".viewed-toggle-button").exists()).toBe(false);
    expect(wrapper.find(".review-progress-actions").exists()).toBe(false);
    expect(wrapper.emitted("reviewProgress")).toBeUndefined();
    expect(
      storage.get("mergebeacon:review-progress:github:octocat:hello-world:42:range-head"),
    ).toBe(undefined);
  });

  it("按 PR 和 head SHA 保存本地文件已查看状态并显示进度", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "head-1",
    });

    expect(wrapper.get(".local-progress-label").text()).toContain("0/2 已查看");
    await wrapper.get(".viewed-toggle-button").trigger("click");

    expect(wrapper.get(".local-progress-label").text()).toContain("1/2 已查看");
    expect(wrapper.get('[data-file-path="src/components/App.ts"]').classes()).toContain("viewed");
    expect(wrapper.get(".viewed-toggle-button").attributes("aria-pressed")).toBe("true");
    expect(storage.get("mergebeacon:review-progress:github:octocat:hello-world:42:head-1")).toBe(
      '["src/components/App.ts"]',
    );
  });

  it("GitHub 从远端加载文件已查看状态并同步修改", async () => {
    reviewViewedFilesListMock.mockResolvedValue(["tests/App.spec.ts"]);
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "head-1",
      canSyncViewedFiles: true,
    });

    expect(reviewViewedFilesListMock).toHaveBeenCalledWith("github", "octocat", "hello-world", 42);
    expect(wrapper.get(".local-progress-label").text()).toContain("远端 1/2 已查看");
    expect(wrapper.get('[data-file-path="tests/App.spec.ts"]').classes()).toContain("viewed");

    await wrapper.get(".viewed-toggle-button").trigger("click");
    await flushPromises();

    expect(reviewFileSetViewedMock).toHaveBeenCalledWith(
      "github",
      "octocat",
      "hello-world",
      42,
      "src/components/App.ts",
      true,
    );
    expect(wrapper.get(".local-progress-label").text()).toContain("远端 2/2 已查看");
  });

  it("远端文件状态写入失败时回滚并显示错误", async () => {
    reviewFileSetViewedMock.mockRejectedValue(new Error("Token 权限不足"));
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "head-1",
      canSyncViewedFiles: true,
    });

    await wrapper.get(".viewed-toggle-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".viewed-toggle-button").attributes("aria-pressed")).toBe("false");
    expect(wrapper.get(".review-progress-error").text()).toContain("Token 权限不足");
    expect(storage.get("mergebeacon:review-progress:github:octocat:hello-world:42:head-1")).toBe(
      "[]",
    );
  });

  it("远端文件状态加载期间禁用切换，避免迟到响应覆盖写入", async () => {
    let resolveViewedFiles: ((paths: string[]) => void) | undefined;
    reviewViewedFilesListMock.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveViewedFiles = resolve;
      }),
    );
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "head-1",
      canSyncViewedFiles: true,
    });

    expect(wrapper.get(".viewed-toggle-button").attributes()).toHaveProperty("disabled");
    resolveViewedFiles?.([]);
    await flushPromises();

    expect(wrapper.get(".viewed-toggle-button").attributes()).not.toHaveProperty("disabled");
  });

  it("可以导航到下一个未查看文件并展示未解决线程数量", async () => {
    const wrapper = await mountViewer(standardizedDiff, {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      headSha: "head-1",
    });
    await wrapper.get(".viewed-toggle-button").trigger("click");
    await wrapper.get('[aria-label="下一个未查看文件"]').trigger("click");
    await flushPromises();

    expect(wrapper.get(".selected-file-name").text()).toBe("tests/App.spec.ts");

    await wrapper.setProps({
      threadSummary: {
        comments: 3,
        threads: 2,
        unresolved: 1,
        by_file: {
          "tests/App.spec.ts": { comments: 2, unresolved: 1 },
        },
      },
    });

    expect(wrapper.get('[data-file-path="tests/App.spec.ts"] .unresolved-indicator').text()).toBe(
      "1",
    );
  });

  it("选择文件后右侧只显示对应的 Diff 上下文", async () => {
    const wrapper = await mountViewer();
    const renderedFiles = wrapper.findAll<HTMLElement>(".d2h-file-wrapper");

    expect(renderedFiles).toHaveLength(2);
    expect(renderedFiles[0].element.hidden).toBe(false);
    expect(renderedFiles[1].element.hidden).toBe(true);

    await wrapper.get('[data-file-path="tests/App.spec.ts"]').trigger("click");
    await flushPromises();

    expect(renderedFiles[0].element.hidden).toBe(true);
    expect(renderedFiles[1].element.hidden).toBe(false);
    expect(wrapper.get(".selected-file-name").text()).toBe("tests/App.spec.ts");
  });

  it("diff2html 回退视图只搜索当前选中文件", async () => {
    const wrapper = await mountViewer();

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const leftPane = wrapper.get('.code-search-pane[data-side="left"]');
    const rightPane = wrapper.get('.code-search-pane[data-side="right"]');
    const leftSearch = leftPane.get<HTMLInputElement>('input[type="search"]');
    const rightSearch = rightPane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(leftSearch, "state");

    expect(leftPane.get(".code-search-result").text()).toBe("1/1");
    expect(wrapper.findAll("mark.diff-search-match")).toHaveLength(1);

    await wrapper.get('[data-file-path="tests/App.spec.ts"]').trigger("click");
    await flushPromises();
    expect(leftPane.get(".code-search-result").text()).toBe("无结果");
    expect(wrapper.find("mark.diff-search-match").exists()).toBe(false);

    await setCodeSearchQuery(rightSearch, "works");
    expect(rightPane.get(".code-search-result").text()).toBe("1/1");
    expect(wrapper.get("mark.diff-search-match.active").text()).toBe("works");
  });

  it("目录支持折叠并保留当前文件上下文", async () => {
    const wrapper = await mountViewer();
    const srcDirectory = wrapper
      .findAll<HTMLButtonElement>('[role="treeitem"]')
      .find((row) => !row.attributes("data-file-path") && row.text().trim() === "src");

    expect(srcDirectory).toBeDefined();
    if (!srcDirectory) throw new Error("未找到 src 目录节点");
    await srcDirectory.trigger("click");

    expect(
      wrapper.get('[role="tree"]').find('[data-file-path="src/components/App.ts"]').exists(),
    ).toBe(false);
    expect(wrapper.get(".selected-file-name").text()).toBe("src/components/App.ts");
  });

  it("顶部横向滚动条与左右 Diff 同步滚动", async () => {
    const wrapper = await mountViewer();
    const topScrollbar = wrapper.get<HTMLElement>(".diff-top-scrollbar");
    const sideScrollers = wrapper.findAll<HTMLElement>(".d2h-file-side-diff").slice(0, 2);

    expect(sideScrollers).toHaveLength(2);
    topScrollbar.element.scrollLeft = 120;
    await topScrollbar.trigger("scroll");
    expect(sideScrollers[0].element.scrollLeft).toBe(120);
    expect(sideScrollers[1].element.scrollLeft).toBe(120);
    expect(sideScrollers[0].attributes("style")).toBeUndefined();
    expect(sideScrollers[1].attributes("style")).toBeUndefined();

    sideScrollers[0].element.scrollLeft = 48;
    await sideScrollers[0].trigger("scroll");
    expect(sideScrollers[1].element.scrollLeft).toBe(48);
    expect(topScrollbar.element.scrollLeft).toBe(48);
  });

  it("关闭同步滚动后在顶部显示左右独立滚动条", async () => {
    useUiSettingsStore().setDiffSyncScrollEnabled(false);
    const wrapper = await mountViewer();
    const topScrollbars = wrapper.findAll<HTMLElement>(".diff-top-scrollbar");
    const sideScrollers = wrapper.findAll<HTMLElement>(".d2h-file-side-diff").slice(0, 2);

    expect(wrapper.get(".diff-top-scrollbars").classes()).toContain("independent");
    expect(topScrollbars).toHaveLength(2);
    expect(sideScrollers).toHaveLength(2);

    topScrollbars[0].element.scrollLeft = 64;
    await topScrollbars[0].trigger("scroll");

    expect(sideScrollers[0].element.scrollLeft).toBe(64);
    expect(sideScrollers[1].element.scrollLeft).toBe(0);
    expect(sideScrollers[0].attributes("style")).toBeUndefined();
    expect(sideScrollers[1].attributes("style")).toBeUndefined();

    sideScrollers[1].element.scrollLeft = 32;
    await sideScrollers[1].trigger("scroll");

    expect(topScrollbars[0].element.scrollLeft).toBe(64);
    expect(topScrollbars[1].element.scrollLeft).toBe(32);
  });

  it("低相似度替换行只保留整行浅色背景", async () => {
    const unrelatedDiff: DiffResult = {
      diff: `diff --git a/src/handler.ts b/src/handler.ts
index 1111111..2222222 100644
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1 +1 @@
-const oldHandler = createLegacyHandler();
+export async function loadRepositoryContext() {`,
      files: [
        {
          filename: "src/handler.ts",
          status: "modified",
          patch:
            "@@ -1 +1 @@\n-const oldHandler = createLegacyHandler();\n+export async function loadRepositoryContext() {",
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [],
    };

    const wrapper = await mountViewer(unrelatedDiff);
    const inlineHighlights = wrapper.findAll<HTMLElement>(
      ".d2h-code-line-ctn ins, .d2h-code-line-ctn del",
    );

    expect(inlineHighlights.length).toBeGreaterThan(0);
    expect(
      inlineHighlights.every((highlight) =>
        highlight.classes().includes("d2h-low-similarity-highlight"),
      ),
    ).toBe(true);
    expect(inlineHighlights.some((highlight) => highlight.element.tagName === "DEL")).toBe(true);
    expect(inlineHighlights.some((highlight) => highlight.element.tagName === "INS")).toBe(true);
  });

  it("局部字符变化仍保留词级高亮", async () => {
    const localChangeDiff: DiffResult = {
      diff: `diff --git a/src/config.ts b/src/config.ts
index 1111111..2222222 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1 +1 @@
-const timeout = 1000;
+const timeout = 2000;`,
      files: [
        {
          filename: "src/config.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n-const timeout = 1000;\n+const timeout = 2000;",
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [],
    };

    const wrapper = await mountViewer(localChangeDiff);
    const inlineHighlights = wrapper.findAll<HTMLElement>(
      ".d2h-code-line-ctn ins, .d2h-code-line-ctn del",
    );

    expect(inlineHighlights).toHaveLength(2);
    expect(
      inlineHighlights.some((highlight) =>
        highlight.classes().includes("d2h-low-similarity-highlight"),
      ),
    ).toBe(false);

    await wrapper.get('[aria-label="查找代码"]').trigger("click");
    const leftPane = wrapper.get('.code-search-pane[data-side="left"]');
    const rightPane = wrapper.get('.code-search-pane[data-side="right"]');
    const leftSearch = leftPane.get<HTMLInputElement>('input[type="search"]');
    const rightSearch = rightPane.get<HTMLInputElement>('input[type="search"]');
    await setCodeSearchQuery(leftSearch, "timeout = 1000");

    const deletionMatch = wrapper.get("mark.diff-search-match.active");
    expect(leftPane.get(".code-search-result").text()).toBe("1/1");
    expect(deletionMatch.text()).toBe("timeout = 1000");
    expect(deletionMatch.find("del").exists()).toBe(true);

    await setCodeSearchQuery(rightSearch, "timeout = 2000");

    const additionMatch = wrapper
      .findAll(".d2h-file-side-diff")[1]
      .get("mark.diff-search-match.active");
    expect(rightPane.get(".code-search-result").text()).toBe("1/1");
    expect(additionMatch.text()).toBe("timeout = 2000");
    expect(additionMatch.find("ins").exists()).toBe(true);
  });

  it("标准化高亮时仍将远端 HTML 作为文本渲染", async () => {
    const htmlDiff: DiffResult = {
      diff: `diff --git a/src/value.ts b/src/value.ts
index 1111111..2222222 100644
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-const value = "<script>";
+const value = "<safe>";`,
      files: [
        {
          filename: "src/value.ts",
          status: "modified",
          patch: '@@ -1 +1 @@\n-const value = "<script>";\n+const value = "<safe>";',
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [],
    };

    const wrapper = await mountViewer(htmlDiff);

    expect(wrapper.get(".diff2html-container").text()).toContain("<script>");
    expect(wrapper.get(".diff2html-container").text()).toContain("<safe>");
    expect(wrapper.find(".diff2html-container script").exists()).toBe(false);
    expect(wrapper.find(".diff2html-container safe").exists()).toBe(false);
  });

  it("文件名右侧的复制按钮把当前文件路径写入系统剪贴板", async () => {
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    const wrapper = await mountViewer();
    const copyButton = wrapper.get(".copy-file-path-button");

    // 按钮必须紧跟在文件名之后，复制的内容就是标题里展示的完整路径。
    expect(
      copyButton.element.previousElementSibling?.classList.contains("selected-file-name"),
    ).toBe(true);
    expect(copyButton.attributes("aria-label")).toBe("复制文件路径");

    await copyButton.trigger("click");
    await flushPromises();

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("src/components/App.ts");
    expect(wrapper.get(".copy-file-path-button").classes()).toContain("copied");
    expect(wrapper.get(".copy-file-path-button").attributes("aria-label")).toBe("文件路径已复制");
    expect(wrapper.find(".file-path-copy-error").exists()).toBe(false);
  });

  it("切换文件后复制按钮回到初始状态并复制新文件路径", async () => {
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    const wrapper = await mountViewer();

    await wrapper.get(".copy-file-path-button").trigger("click");
    await flushPromises();
    expect(wrapper.get(".copy-file-path-button").classes()).toContain("copied");

    await wrapper.get('[data-file-path="tests/App.spec.ts"]').trigger("click");
    await flushPromises();
    expect(wrapper.get(".copy-file-path-button").classes()).not.toContain("copied");

    await wrapper.get(".copy-file-path-button").trigger("click");
    await flushPromises();
    expect(clipboardWriteTextMock).toHaveBeenLastCalledWith("tests/App.spec.ts");
  });

  it("剪贴板写入失败时就近提示且不显示已复制状态", async () => {
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockRejectedValue(new Error("clipboard denied"));
    const wrapper = await mountViewer();

    await wrapper.get(".copy-file-path-button").trigger("click");
    await flushPromises();

    const error = wrapper.get(".file-path-copy-error");
    expect(error.attributes("role")).toBe("alert");
    expect(error.attributes("aria-atomic")).toBe("true");
    expect(error.text()).toContain("clipboard denied");
    expect(wrapper.get(".copy-file-path-button").classes()).not.toContain("copied");
  });

  it("没有选中文件时不渲染复制按钮", async () => {
    const wrapper = mount(DiffViewer, { props: { diff: null } });
    await flushPromises();

    expect(wrapper.find(".copy-file-path-button").exists()).toBe(false);
  });

  it("可以隐藏和恢复文件导航栏", async () => {
    const wrapper = await mountViewer();
    const toggle = wrapper.get(".navigator-toggle");

    await toggle.trigger("click");
    expect(wrapper.find(".file-navigator").exists()).toBe(false);
    expect(wrapper.get(".diff-workspace").classes()).toContain("navigator-collapsed");

    await toggle.trigger("click");
    expect(wrapper.find(".file-navigator").exists()).toBe(true);
  });

  it("只读模式不接管右键操作或打开评论框", async () => {
    const wrapper = await mountViewer(diff, { readOnly: true });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    wrapper.get(".diff-viewer-wrapper").element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".quick-comment-popup")).toBeNull();
  });

  it("挂载后切换只读状态时同步更新右键监听器", async () => {
    const wrapper = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff, readOnly: true },
    });
    await flushPromises();
    const target = wrapper.get(".diff2html-container");

    const initialEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.element.dispatchEvent(initialEvent);
    expect(initialEvent.defaultPrevented).toBe(false);

    await wrapper.setProps({ readOnly: false });
    await flushPromises();
    const writableEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    wrapper.get(".diff2html-container").element.dispatchEvent(writableEvent);
    expect(writableEvent.defaultPrevented).toBe(true);

    await wrapper.setProps({ readOnly: true });
    await flushPromises();
    const readOnlyEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    wrapper.get(".diff2html-container").element.dispatchEvent(readOnlyEvent);
    expect(readOnlyEvent.defaultPrevented).toBe(false);

    wrapper.unmount();
  });

  it("卸载只读实例不会移除其他可写实例的右键监听器", async () => {
    const writable = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff, readOnly: false },
    });
    const readOnly = mount(DiffViewer, {
      attachTo: document.body,
      props: { diff, readOnly: true },
    });
    await flushPromises();

    const beforeUnmount = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    writable.get(".diff2html-container").element.dispatchEvent(beforeUnmount);
    expect(beforeUnmount.defaultPrevented).toBe(true);

    readOnly.unmount();
    const afterUnmount = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    writable.get(".diff2html-container").element.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(true);

    writable.unmount();
  });
});
