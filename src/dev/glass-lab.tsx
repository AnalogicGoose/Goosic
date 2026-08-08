/**
 * Glass Lab — a dev-only bench for the Liquid Glass material.
 *
 * The point is a like-for-like comparison of the two renderers on one machine:
 * open `/glass-lab.html?platform=windows` for the SVG refraction pipeline and
 * `?platform=macos` for the native WKWebView material (or Chromium's plain
 * backdrop blur, which is what the macOS path degrades to off-WebKit). The
 * page mounts the real components and the real class constants from
 * `glass-surface.ts`, so what it shows is what the app shows — nothing here
 * re-implements the material.
 *
 * Not part of the app bundle: Vite only serves it because `glass-lab.html`
 * sits next to `index.html`, and Tauri loads `index.html`.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiquidGlassDefs } from "@/components/layout/liquid-glass-defs";
import {
  DIALOG_GLASS_SURFACE_CLASS,
  INTERACTIVE_GLASS_CONTROL_CLASS,
  MENU_GLASS_SURFACE_CLASS,
  PLAYER_GLASS_SURFACE_CLASS,
  STATIC_GLASS_CONTROL_CLASS,
} from "@/components/ui/glass-surface";
import { isMacOSWebview, isWindowsWebview } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";
import {
  GLASS_MATERIALS,
  supportsNativeLiquidGlass,
  useGlassMaterial,
  webGlassMaterialTokens,
  type GlassMaterialId,
} from "@/lib/themes";
import "@/index.css";

/**
 * Backdrops chosen for what they expose, not for looks: `chroma` shows RGB
 * dispersion at the bezel, `grid` shows whether the refraction bends straight
 * lines symmetrically on all four edges, and `contrast` shows frost falloff
 * and any inverted/folded band at the rim.
 */
const BACKDROPS = {
  chroma:
    "radial-gradient(60% 80% at 20% 30%, #ff2d55 0%, transparent 60%), radial-gradient(50% 70% at 80% 20%, #0a84ff 0%, transparent 60%), radial-gradient(70% 70% at 60% 90%, #30d158 0%, transparent 60%), linear-gradient(120deg, #1c1c1e, #3a3a3c)",
  grid: "repeating-linear-gradient(0deg, #fff 0 2px, transparent 2px 28px), repeating-linear-gradient(90deg, #fff 0 2px, transparent 2px 28px), linear-gradient(120deg, #0a2540, #123)",
  contrast:
    "repeating-linear-gradient(45deg, #000 0 24px, #fff 24px 48px)",
  /**
   * The condition the material actually ships into: near-black chrome with a
   * row of saturated album tiles. Dark backdrops are the hard case, because
   * that is where a purely transmissive material has nothing to transmit.
   */
  app: "linear-gradient(90deg, #0b0b0d 0 240px, transparent 240px), repeating-linear-gradient(90deg, #e0457b 260px 400px, #0a0a0a 400px 420px, #2f7bd6 420px 560px, #0a0a0a 560px 580px, #d9a441 580px 720px, #0a0a0a 720px 740px, #46a06a 740px 880px, #0a0a0a 880px 900px), #060607",
} as const;

type BackdropId = keyof typeof BACKDROPS;

/** Drag a specimen across the backdrop to inspect the optic over any region. */
function useDrag(initial: { x: number; y: number }) {
  const [position, setPosition] = useState(initial);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setPosition({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY,
      });
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  return { position, onPointerDown };
}

function Specimen({
  label,
  className,
  width,
  height,
  radius,
  origin,
}: {
  label: string;
  className: string;
  width: number;
  height: number;
  radius: number;
  origin: { x: number; y: number };
}) {
  const { position, onPointerDown } = useDrag(origin);
  return (
    <div
      onPointerDown={onPointerDown}
      className={`${className} absolute grid cursor-grab select-none place-items-center text-xs`}
      style={{
        left: position.x,
        top: position.y,
        width,
        height,
        borderRadius: radius,
      }}
    >
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function GlassLab() {
  // The lab drives the same store field the app does, so switching material
  // here exercises the real code path rather than a lab-only shortcut.
  const material = useSettingsStore((s) => s.glassMaterial);
  const setMaterial = useSettingsStore((s) => s.setGlassMaterial);
  const [backdrop, setBackdrop] = useState<BackdropId>("chroma");
  useGlassMaterial(material);
  const tokens = webGlassMaterialTokens(material);

  // The renderer classes normally come from `useGlassPlatformClasses()`, which
  // lives behind app-only hooks; apply the same two classes the same way, so
  // the `?platform=` override selects the renderer here exactly as it does in
  // the app.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("liquid-refract", isWindowsWebview());
    root.classList.toggle("macos-backdrop-glass", isMacOSWebview());
  }, []);

  // Cmd/Ctrl+Shift+G returns to the app, matching the chord that got here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "g") return;
      event.preventDefault();
      window.location.href = "/";
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The two renderers cannot both be evaluated in one browser: Chromium is the
  // only engine that runs an SVG filter in `backdrop-filter`, and Apple's
  // `-apple-visual-effect` only resolves inside the app's WKWebView. So this
  // states plainly which one is actually painting, rather than which one was
  // requested.
  const renderer = isWindowsWebview()
    ? "Windows SVG refraction"
    : supportsNativeLiquidGlass()
      ? "macOS native Liquid Glass"
      : isMacOSWebview()
        ? "macOS path, CSS blur only — open this in the app for the real material"
        : "no glass renderer active";

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ background: BACKDROPS[backdrop], backgroundSize: "cover" }}
    >
      <Specimen
        label="player · large"
        className={PLAYER_GLASS_SURFACE_CLASS}
        width={720}
        height={88}
        radius={22}
        origin={{ x: 80, y: 520 }}
      />
      <Specimen
        label="dialog · large"
        className={DIALOG_GLASS_SURFACE_CLASS}
        width={380}
        height={260}
        radius={26}
        origin={{ x: 120, y: 180 }}
      />
      <Specimen
        label="menu · medium"
        className={MENU_GLASS_SURFACE_CLASS}
        width={220}
        height={180}
        radius={16}
        origin={{ x: 560, y: 200 }}
      />
      <Specimen
        label="interactive · small"
        className={INTERACTIVE_GLASS_CONTROL_CLASS}
        width={140}
        height={36}
        radius={18}
        origin={{ x: 840, y: 200 }}
      />
      <Specimen
        label="static · small"
        className={STATIC_GLASS_CONTROL_CLASS}
        width={140}
        height={36}
        radius={18}
        origin={{ x: 840, y: 260 }}
      />

      <div className="absolute right-4 top-4 w-64 space-y-3 rounded-xl bg-black/70 p-4 text-xs text-white backdrop-blur">
        <div className="font-medium">{renderer}</div>
        <label className="block space-y-1">
          <span className="opacity-70">Material</span>
          <select
            value={material}
            onChange={(event) =>
              setMaterial(event.target.value as GlassMaterialId)
            }
            className="w-full rounded bg-white/10 p-1"
          >
            {GLASS_MATERIALS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="opacity-70">Backdrop</span>
          <select
            value={backdrop}
            onChange={(event) =>
              setBackdrop(event.target.value as BackdropId)
            }
            className="w-full rounded bg-white/10 p-1"
          >
            {Object.keys(BACKDROPS).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <div className="opacity-70">
          synthesized: {tokens.frost}px frost · {tokens.luminosity}% fill
        </div>
        <div className="opacity-60">
          Drag any specimen. ?platform=windows | macos | auto overrides the
          renderer. Cmd/Ctrl+Shift+G returns to the app.
        </div>
      </div>

      <LiquidGlassDefs />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlassLab />
  </StrictMode>,
);
