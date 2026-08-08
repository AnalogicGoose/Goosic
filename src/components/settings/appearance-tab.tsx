import { Fragment, useState } from "react";
import {
  ChevronDownIcon,
  DropletsIcon,
  LayoutDashboardIcon,
  PaletteIcon,
  WallpaperIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useLayoutStore, type LayoutMode } from "@/lib/store/layout";
import { useSettingsStore, type BackgroundMode } from "@/lib/store/settings";
import {
  GLASS_MATERIAL_GROUPS,
  GLASS_MATERIALS,
  getGlassMaterial,
  getVisualTheme,
  isGlassMaterialId,
  supportsNativeLiquidGlass,
  VISUAL_THEMES,
  type VisualThemeId,
} from "@/lib/themes";

const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: "right", label: "Side card" },
  { value: "bottom", label: "Bottom bar" },
  { value: "floating", label: "Floating" },
];

const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
  { value: "ambient", label: "Ambient" },
  { value: "plain", label: "Plain" },
];

export function AppearanceTab() {
  const visualTheme = useSettingsStore((s) => s.visualTheme);
  const setVisualTheme = useSettingsStore((s) => s.setVisualTheme);
  const glassMaterial = useSettingsStore((s) => s.glassMaterial);
  const setGlassMaterial = useSettingsStore((s) => s.setGlassMaterial);
  const layoutMode = useLayoutStore((s) => s.mode);
  const setLayoutMode = useLayoutStore((s) => s.setMode);
  const background = useSettingsStore((s) => s.background);
  const setBackground = useSettingsStore((s) => s.setBackground);
  // Material selection is platform-independent now: macOS resolves these ids
  // to real system materials, everywhere else the SVG renderer synthesizes the
  // same stop from `WEB_GLASS_MATERIAL_TOKENS`. Only the wording differs, so
  // the description can say which of the two is happening. Read once: the
  // capability cannot change while the window is open.
  const [nativeMaterial] = useState(supportsNativeLiquidGlass);

  return (
    <TabPane tightTop>
      <Group>
        <SettingRow
          icon={PaletteIcon}
          title="Interface style"
          description="Default keeps album art and metadata up front; Modern centers the now-playing bar with the transport on the left."
          control={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-36 justify-between gap-2"
                  aria-label="Interface style"
                >
                  <ThemeSwatch id={visualTheme} />
                  <span className="truncate">
                    {getVisualTheme(visualTheme).label}
                  </span>
                  <ChevronDownIcon className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  value={visualTheme}
                  onValueChange={(value) => {
                    const next = value as VisualThemeId;
                    if (VISUAL_THEMES.some((item) => item.id === next)) {
                      setVisualTheme(next);
                    }
                  }}
                >
                  {VISUAL_THEMES.map((item) => (
                    <DropdownMenuRadioItem key={item.id} value={item.id}>
                      <ThemeSwatch id={item.id} />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>{item.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <SettingRow
          icon={DropletsIcon}
          title="Glass material"
          description={
            nativeMaterial
              ? "Which system material the glass uses. macOS draws the frost itself, so this picks the material rather than a blur radius."
              : "How the glass frosts and lights the content behind it. Each stop matches one of the macOS system materials."
          }
          control={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-44 justify-between gap-2"
                  aria-label="Glass material"
                >
                  {/* Both families have a "Regular", so the trigger names the
                        family too or the current choice reads ambiguously. */}
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate">
                      {getGlassMaterial(glassMaterial).label}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {getGlassMaterial(glassMaterial).group}
                    </span>
                  </span>
                  <ChevronDownIcon className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuRadioGroup
                  value={glassMaterial}
                  onValueChange={(value) => {
                    if (isGlassMaterialId(value)) setGlassMaterial(value);
                  }}
                >
                  {GLASS_MATERIAL_GROUPS.map((group, groupIndex) => (
                    <Fragment key={group}>
                      {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {group}
                      </DropdownMenuLabel>
                      {GLASS_MATERIALS.filter(
                        (item) => item.group === group,
                      ).map((item) => (
                        <DropdownMenuRadioItem key={item.id} value={item.id}>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span>{item.label}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </Fragment>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <SettingRow
          icon={LayoutDashboardIcon}
          title="Player layout"
          description="Choose where the now-playing card lives."
          control={
            <SegmentedControl
              value={layoutMode}
              onChange={setLayoutMode}
              options={LAYOUT_OPTIONS}
            />
          }
        />
        <SettingRow
          icon={WallpaperIcon}
          title="Background"
          description="Use visuals from the current album art, or keep the window plain."
          control={
            <SegmentedControl
              value={background}
              onChange={setBackground}
              options={BACKGROUND_OPTIONS}
            />
          }
        />
      </Group>
    </TabPane>
  );
}

function ThemeSwatch({ id }: { id: VisualThemeId }) {
  const [first, second, third] = getVisualTheme(id).swatches;
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/20"
      style={{
        background: `linear-gradient(135deg, ${first} 0 38%, ${second} 38% 70%, ${third} 70%)`,
      }}
    />
  );
}
