import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { usesRoundedNativeWindow } from "@/lib/platform";

// Undecorated Tauri windows stay rectangular on macOS/Linux. Mark those
// platforms before the first paint so CSS can clip the app surface to the
// shared radius while the transparent native window reveals the desktop.
if (usesRoundedNativeWindow()) {
  document.documentElement.classList.add("native-rounded-window");
}

// Suppress the WebView2 / Chromium native right-click menu (Back,
// Refresh, Save as, Inspect, …). Our Radix ContextMenu triggers run
// their own `preventDefault` first to open custom menus, so this
// global handler only fires for clicks on areas without a custom menu.
// DevTools stay reachable via F12 / Ctrl+Shift+I.
window.addEventListener("contextmenu", (e) => e.preventDefault());

// Glass Lab is reachable from inside the app in dev because that is the only
// place the macOS material actually exists: `-apple-visual-effect` is private
// and only resolves in this WKWebView, never in Chrome. Cmd/Ctrl+Shift+G does
// a real page navigation, so the lab loads in the same native window with the
// same WKPreferences. The lab binds the same chord to come back.
if (import.meta.env.DEV) {
  window.addEventListener("keydown", (event) => {
    if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() !== "g") return;
    event.preventDefault();
    window.location.href = "/glass-lab.html";
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
