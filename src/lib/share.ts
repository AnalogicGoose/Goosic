/**
 * Canonical music.youtube.com links plus clipboard access.
 *
 * Goosic has no clipboard plugin, so this uses the WebView's own async
 * clipboard API with a `execCommand` fallback for WebKitGTK, which
 * refuses `navigator.clipboard.writeText` outside a user-gesture-scoped
 * secure context often enough to matter. Both paths can genuinely fail,
 * so the caller is told rather than shown a success toast that lied.
 */

const BASE = "https://music.youtube.com";

export function trackUrl(videoId: string): string {
  return `${BASE}/watch?v=${encodeURIComponent(videoId)}`;
}

export function playlistUrl(playlistId: string): string {
  const bare = playlistId.startsWith("VL") ? playlistId.slice(2) : playlistId;
  return `${BASE}/playlist?list=${encodeURIComponent(bare)}`;
}

export function artistUrl(channelId: string): string {
  return `${BASE}/channel/${encodeURIComponent(channelId)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than reporting failure yet.
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    // Keep it off-screen and unfocusable-looking, but still selectable —
    // `display: none` makes the selection (and therefore the copy) fail.
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
