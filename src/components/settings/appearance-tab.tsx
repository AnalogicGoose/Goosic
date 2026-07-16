import { useTheme } from "next-themes";
import {
  ChevronDownIcon,
  LayoutDashboardIcon,
  PaletteIcon,
  WallpaperIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useLayoutStore, type LayoutMode } from "@/lib/store/layout";
import { useSettingsStore, type BackgroundMode } from "@/lib/store/settings";
import {
  getVisualTheme,
  VISUAL_THEMES,
  type VisualThemeId,
} from "@/lib/themes";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

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
  const { theme, setTheme } = useTheme();
  const visualTheme = useSettingsStore((s) => s.visualTheme);
  const setVisualTheme = useSettingsStore((s) => s.setVisualTheme);
  const layoutMode = useLayoutStore((s) => s.mode);
  const setLayoutMode = useLayoutStore((s) => s.setMode);
  const background = useSettingsStore((s) => s.background);
  const setBackground = useSettingsStore((s) => s.setBackground);

  return (
    <TabPane tightTop>
      <Group>
        <SettingRow
          icon={PaletteIcon}
          title="Interface style"
          description="Choose a complete visual child theme. Every shared component consumes the same semantic tokens and material settings."
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
          icon={PaletteIcon}
          title="Theme"
          description="Choose light or dark, or follow your OS preference."
          control={
            <SegmentedControl
              // `theme` is undefined during the very first render
              // (next-themes resolves it on mount) — fall back to
              // "system" so the control never renders empty.
              value={theme ?? "system"}
              onChange={setTheme}
              options={THEME_OPTIONS}
            />
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
