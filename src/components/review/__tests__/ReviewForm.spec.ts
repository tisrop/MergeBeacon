import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ReviewForm from "../ReviewForm.vue";
import { reviewSubmit } from "@/api";

vi.mock("@/api", () => ({ reviewSubmit: vi.fn() }));

const props = { owner: "team", repo: "repo", prNumber: 1 };

describe("ReviewForm", () => {
  it.each(["gitlab", "gitee"] as const)("%s 只展示评论操作", (platform) => {
    const wrapper = mount(ReviewForm, { props: { ...props, platform } });
    const labels = wrapper.findAll(".event-select button").map((button) => button.text());
    expect(labels).toEqual(["评论"]);
  });

  it("GitHub 展示全部评审操作", () => {
    const wrapper = mount(ReviewForm, { props: { ...props, platform: "github" } });
    expect(wrapper.findAll(".event-select button").map((button) => button.text())).toEqual([
      "评论",
      "批准",
      "请求修改",
    ]);
  });

  it("从 GitHub 切换到 GitLab 时重置不支持的评审事件", async () => {
    vi.mocked(reviewSubmit).mockResolvedValue({
      id: 1,
      body: "切换平台后的评论",
      state: "commented",
      author: { id: 1, login: "user", name: "User", avatar_url: "" },
      submitted_at: "",
    });
    const wrapper = mount(ReviewForm, { props: { ...props, platform: "github" } });
    await wrapper.findAll(".event-select button")[1].trigger("click");
    await wrapper.setProps({ platform: "gitlab" });
    await wrapper.get("textarea").setValue("切换平台后的评论");
    await wrapper.get(".btn-primary").trigger("click");
    await flushPromises();

    expect(reviewSubmit).toHaveBeenCalledWith(
      "gitlab",
      "team",
      "repo",
      1,
      "切换平台后的评论",
      "comment",
      [],
    );
  });
});
