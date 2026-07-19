export const APP_COMMAND_EVENT = "mergebeacon:app-command";

export type AppCommandDetail =
  | { type: "open_diff_file"; path: string }
  | { type: "start_ai_review" }
  | { type: "prepare_review" };

export function dispatchAppCommand(detail: AppCommandDetail): void {
  window.dispatchEvent(new CustomEvent<AppCommandDetail>(APP_COMMAND_EVENT, { detail }));
}
