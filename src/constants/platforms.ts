import type { Platform } from "@/types";

/** 支持的平台，按展示顺序排列。 */
export const PLATFORMS: Platform[] = ["github", "gitlab", "gitee"];

/** 为每个平台构造一条记录，避免各处手写相同的三平台展开。 */
export function platformRecord<T>(factory: () => T): Record<Platform, T> {
  return { github: factory(), gitlab: factory(), gitee: factory() };
}
