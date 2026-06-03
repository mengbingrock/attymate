// Resolves the API origin for fetch / WebSocket / EventSource.
// Default is same-origin (empty prefix), preserving existing behavior.
//
// Override sources, in priority order:
//   1. window.__PAPERCLIP_API_URL__   (runtime — set by a native shell like Tauri/Electron)
//   2. import.meta.env.VITE_PAPERCLIP_API_URL  (build-time)
//
// Example values:  "https://paperclip.attymate.com"   "http://192.168.1.10:3100"

declare global {
  interface Window {
    __PAPERCLIP_API_URL__?: string;
  }
}

function trimOrigin(value: string | undefined | null): string {
  if (!value) return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed;
}

let cachedOrigin: string | null = null;

export function apiOrigin(): string {
  if (cachedOrigin !== null) return cachedOrigin;
  const runtime =
    typeof window !== "undefined" ? trimOrigin(window.__PAPERCLIP_API_URL__) : "";
  const env = trimOrigin(import.meta.env.VITE_PAPERCLIP_API_URL);
  cachedOrigin = runtime || env || "";
  return cachedOrigin;
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  return `${apiOrigin()}/api${ensureLeadingSlash(path)}`;
}

export function wsUrl(path: string): string {
  const origin = apiOrigin();
  const apiPath = `/api${ensureLeadingSlash(path)}`;
  if (origin) {
    const url = new URL(origin);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}${apiPath}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${apiPath}`;
}
