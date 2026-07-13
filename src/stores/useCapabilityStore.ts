import { defineStore } from "pinia";
import { ref } from "vue";
import { getPlatformCapabilities } from "@/api";
import type { Platform, PlatformCapabilities } from "@/types";
import { getErrorMessage } from "@/utils/error";

function platformRecord<T>(factory: () => T): Record<Platform, T> {
  return { github: factory(), gitlab: factory(), gitee: factory() };
}

export const useCapabilityStore = defineStore("capabilities", () => {
  const values = ref<Record<Platform, PlatformCapabilities | null>>(platformRecord(() => null));
  const errors = ref<Record<Platform, string>>(platformRecord(() => ""));
  const pending = new Map<Platform, Promise<PlatformCapabilities>>();

  async function load(platform: Platform): Promise<PlatformCapabilities> {
    const cached = values.value[platform];
    if (cached) return cached;
    const existing = pending.get(platform);
    if (existing) return existing;

    errors.value[platform] = "";
    const request = getPlatformCapabilities(platform)
      .then((capabilities) => {
        values.value[platform] = capabilities;
        return capabilities;
      })
      .catch((error) => {
        errors.value[platform] = getErrorMessage(error, "读取平台能力失败");
        throw error;
      })
      .finally(() => pending.delete(platform));
    pending.set(platform, request);
    return request;
  }

  return { values, errors, load };
});
