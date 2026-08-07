import { createRouter, createWebHistory } from "vue-router";
import { recordSettingsEntry } from "@/services/settingsReturnNavigation";
import { useAuthStore } from "@/stores/useAuthStore";
import type { Platform } from "@/types";

const LoginPage = () => import("@/pages/LoginPage.vue");
const PrListPage = () => import("@/pages/PrListPage.vue");
const ReviewInboxPage = () => import("@/pages/ReviewInboxPage.vue");
const PrNewPage = () => import("@/pages/PrNewPage.vue");
const PrDetailPage = () => import("@/pages/PrDetailPage.vue");
const IssueListPage = () => import("@/pages/IssueListPage.vue");
const IssueNewPage = () => import("@/pages/IssueNewPage.vue");
const IssueDetailPage = () => import("@/pages/IssueDetailPage.vue");
const SettingsPage = () => import("@/pages/SettingsPage.vue");

const routes = [
  {
    path: "/",
    redirect: "/pr",
  },
  {
    path: "/login",
    name: "login",
    component: LoginPage,
  },
  {
    path: "/inbox",
    name: "review-inbox",
    component: ReviewInboxPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/pr",
    name: "pr-list",
    component: PrListPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/pr/new",
    redirect: () => ({
      name: "pr-new",
      params: { platform: useAuthStore().activePlatform },
    }),
  },
  {
    path: "/pr/new/:platform",
    name: "pr-new",
    component: PrNewPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/pr/:platform/:owner/:repo/:number",
    name: "pr-detail",
    component: PrDetailPage,
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: "/issue",
    name: "issue-list",
    component: IssueListPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/issue/new",
    name: "issue-new",
    component: IssueNewPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/issue/:platform/:owner/:repo/:number",
    name: "issue-detail",
    component: IssueDetailPage,
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: "/settings",
    name: "settings",
    component: SettingsPage,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

function parsePlatform(value: unknown): Platform | undefined {
  return value === "github" || value === "gitlab" || value === "gitee" ? value : undefined;
}

router.beforeEach(async (to, _from, next) => {
  const store = useAuthStore();
  const routePlatform = parsePlatform(to.params.platform);
  const loginPlatform = to.path === "/login" ? parsePlatform(to.query.platform) : undefined;
  const creationPlatform = to.name === "pr-new" ? parsePlatform(to.params.platform) : undefined;
  const targetPlatform = routePlatform ?? loginPlatform ?? creationPlatform;
  const requiresAuthentication = Boolean(to.meta.requiresAuth);

  const explicitPlatform = routePlatform ?? loginPlatform ?? creationPlatform;
  if (explicitPlatform) {
    store.setActivePlatform(explicitPlatform);
  }

  let isLoggedIn = targetPlatform
    ? (store.platforms[targetPlatform]?.isLoggedIn ?? false)
    : store.isLoggedIn;

  // 显式进入登录页时不再用持久化 Token 自动恢复，否则侧栏刚显示“未登录”时，
  // 路由守卫可能又把用户重定向回工作台，表现为登录链接无法打开。
  if (requiresAuthentication && !isLoggedIn) {
    await store.restoreSession(targetPlatform);
    isLoggedIn = targetPlatform
      ? (store.platforms[targetPlatform]?.isLoggedIn ?? false)
      : store.isLoggedIn;
  }

  if (to.path === "/login" && isLoggedIn) {
    next("/pr");
  } else if (to.meta.requiresAuth && !isLoggedIn) {
    next("/login");
  } else {
    next();
  }
});

router.afterEach((to, from, failure) => {
  if (!failure) recordSettingsEntry(to.name, from.name, from.fullPath);
});

export default router;
