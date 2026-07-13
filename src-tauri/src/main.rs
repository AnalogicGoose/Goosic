// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMABUF renderer hangs/blanks on many Wayland compositors
    // (opens fine, then freezes to a black window on the first GPU-heavy
    // paint — e.g. the now-playing background blur). Must be set before
    // GTK/WebKit initialize, so this runs first thing in main(); only sets
    // it if the user hasn't already exported a value, so `WEBKIT_DISABLE_
    // DMABUF_RENDERER=0` still lets someone opt back into the default
    // renderer on a compositor that doesn't hit the bug.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    goosic_lib::run()
}
