//! AppKit material host for the standalone macOS player window.
//!
//! The React player remains the interactive content, but AppKit owns the
//! surface around it. On macOS 26+ that surface is `NSGlassEffectView`, so the
//! refraction, highlights, tinting, and active-window response are genuinely
//! native Liquid Glass rather than a CSS approximation.

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, sel};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSGlassEffectView, NSGlassEffectViewStyle,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow,
};
use objc2_foundation::MainThreadMarker;

const PLAYER_CORNER_RADIUS: f64 = 16.0;

/// The material name is included in the player URL before its web content is
/// created, allowing React to remove its old fake-glass background immediately.
pub fn material_name() -> &'static str {
    if AnyClass::get(c"NSGlassEffectView").is_some() {
        "liquid-glass"
    } else {
        "visual-effect"
    }
}

/// Opt a window's WKWebView into system appearance.
///
/// WebKit only honours the private `-apple-visual-effect` CSS property — real
/// Liquid Glass applied to an element *inside* the page — when
/// `WKPreferences.useSystemAppearance` is on. That preference is Apple private
/// API, which is acceptable here for the same reason `macos-private-api`
/// already is: Goosic ships directly rather than through the Mac App Store.
///
/// This buys what a native host view cannot: interior surfaces (menus,
/// popovers, the player bar) get the genuine material in normal document flow,
/// with their own corner radii, instead of the plain `blur()` fallback
/// WKWebView is limited to today (`.macos-backdrop-glass` in index.css).
///
/// Best effort by design. The selector is resolved at runtime and a system that
/// does not expose it simply keeps the existing CSS fallback — the matching
/// `@supports` block means the stylesheet degrades on its own.
pub fn enable_system_appearance(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|webview| unsafe {
            let wk: *mut AnyObject = webview.inner().cast();
            if wk.is_null() {
                return;
            }
            let config: *mut AnyObject = msg_send![wk, configuration];
            if config.is_null() {
                return;
            }
            let prefs: *mut AnyObject = msg_send![config, preferences];
            if prefs.is_null() {
                return;
            }
            // WebKit has spelled this both ways across releases; probe rather
            // than assume, so an unexpected build cannot raise a selector.
            let plain = sel!(setUseSystemAppearance:);
            let underscored = sel!(_setUseSystemAppearance:);
            if msg_send![prefs, respondsToSelector: plain] {
                let _: () = msg_send![prefs, setUseSystemAppearance: true];
                eprintln!("[glass] WKPreferences system appearance enabled");
            } else if msg_send![prefs, respondsToSelector: underscored] {
                let _: () = msg_send![prefs, _setUseSystemAppearance: true];
                eprintln!("[glass] WKPreferences system appearance enabled (private spelling)");
            } else {
                eprintln!(
                    "[glass] WKPreferences exposes no useSystemAppearance; keeping CSS fallback"
                );
            }
        })
        .map_err(|error| format!("enable system appearance: {error}"))
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let liquid_glass = material_name() == "liquid-glass";

    window
        .with_webview(move |webview| unsafe {
            // Tauri guarantees this callback runs on AppKit's main thread.
            let Some(mtm) = MainThreadMarker::new() else {
                eprintln!("[player] native material callback was not on the main thread");
                return;
            };
            let ns_window: &NSWindow = &*webview.ns_window().cast();
            let Some(content) = ns_window.contentView() else {
                eprintln!("[player] native window has no content view");
                return;
            };
            let frame = content.frame();
            let autoresizing = NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable;

            content.setFrame(frame);
            content.setAutoresizingMask(autoresizing);

            if liquid_glass {
                let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
                glass.setAutoresizingMask(autoresizing);
                glass.setCornerRadius(PLAYER_CORNER_RADIUS);
                glass.setStyle(NSGlassEffectViewStyle::Regular);
                glass.setContentView(Some(&content));
                ns_window.setContentView(Some(&glass));
                eprintln!("[player] native Liquid Glass installed");
            } else {
                let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
                effect.setAutoresizingMask(autoresizing);
                effect.setMaterial(NSVisualEffectMaterial::HUDWindow);
                effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
                effect.setState(NSVisualEffectState::FollowsWindowActiveState);
                effect.addSubview(&content);
                ns_window.setContentView(Some(&effect));
                eprintln!("[player] native visual-effect fallback installed");
            }
        })
        .map_err(|error| format!("install native player material: {error}"))
}
