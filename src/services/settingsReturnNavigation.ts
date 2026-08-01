type RouteName = string | symbol | null | undefined;

let settingsReturnLocation: string | null = null;

export function recordSettingsEntry(
  targetName: RouteName,
  sourceName: RouteName,
  sourceFullPath: string,
) {
  if (targetName !== "settings" || sourceName === "settings") return;
  settingsReturnLocation = sourceName == null ? null : sourceFullPath;
}

export function takeSettingsReturnLocation(): string | null {
  const location = settingsReturnLocation;
  settingsReturnLocation = null;
  return location;
}
