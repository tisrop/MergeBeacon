/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare global {
  type NativeMenuAction = "new-pull-request" | "new-issue" | "check-updates" | "open-diagnostics";

  interface Window {
    __goToSettings?: () => void;
    __openCommandPalette?: () => void;
    __handleNativeMenuAction?: (action: NativeMenuAction) => void;
  }
}

export {};
