/** Operating system of the webview (labels that differ between Windows and Linux). */
const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";

export const IS_WINDOWS = ua.includes("windows");
export const IS_LINUX = !IS_WINDOWS && ua.includes("linux");
export const PLATFORM_OS: "windows" | "linux" | "macos" = IS_WINDOWS ? "windows" : IS_LINUX ? "linux" : "macos";
