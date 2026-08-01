const REDUCED_MOTION_NO_PREFERENCE = "(prefers-reduced-motion: no-preference)";

export function motionAwareScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_NO_PREFERENCE).matches
    ? "smooth"
    : "auto";
}
