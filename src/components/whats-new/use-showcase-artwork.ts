import { useMemo } from "react";
import { queryClient } from "@/lib/query-client";
import { pickThumbnail } from "@/components/shared/thumbnail";
import { usePlaybackStore } from "@/lib/store/playback";
import type { Shelf } from "@/lib/innertube/types";

type HomeFeedCache = { pages?: { shelves?: Shelf[] }[] };

/**
 * Covers strong enough to drive the material, in a deliberate hue order:
 * warm, cool, green, violet, then a high-contrast pair. The story's colour
 * section depends on consecutive covers being far apart in hue, so callers
 * that want contrast should walk this in order rather than shuffle it.
 */
const HUE_PRIORITY = [0, 210, 140, 280, 40, 320, 180, 90];

/**
 * A stand-in cover set for a cold launch with nothing cached yet. These are
 * not decoration: the story is a demonstration of a material reacting to
 * artwork, and with no artwork there is nothing to react to. Deliberately
 * saturated and hard-edged so refraction and colour pickup stay legible.
 */
function fallbackCover(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 95% 58%)"/>
<stop offset="0.55" stop-color="hsl(${(hue + 38) % 360} 88% 46%)"/>
<stop offset="1" stop-color="hsl(${(hue + 76) % 360} 80% 30%)"/>
</linearGradient></defs>
<rect width="512" height="512" fill="url(#g)"/>
<circle cx="150" cy="360" r="130" fill="hsl(${(hue + 180) % 360} 95% 62%)" opacity="0.75"/>
<rect x="286" y="70" width="170" height="170" rx="24" fill="hsl(${(hue + 300) % 360} 96% 68%)" opacity="0.7"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Cover art already on disk, newest-feeling first, deduplicated. */
function cachedArtwork(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const take = (url: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  // The persisted queue first: it is the user's own listening, and it
  // survives a cold start, so the story opens on something familiar.
  for (const track of usePlaybackStore.getState().queue) {
    take(pickThumbnail(track.thumbnails, 512));
  }

  // Then the home feed, which is persisted under the same policy and is by
  // far the richest source of large, vibrant covers.
  const home = queryClient.getQueryData<HomeFeedCache>(["home", "v2"]);
  for (const page of home?.pages ?? []) {
    for (const shelf of page.shelves ?? []) {
      for (const item of shelf.items ?? []) {
        // Artist rows are round crops and category tiles are flat colour
        // chips; neither gives the material anything to refract.
        if (item.kind === "artist" || item.kind === "category") continue;
        take(pickThumbnail(item.thumbnails, 512));
      }
    }
  }

  return urls;
}

/**
 * Artwork for the feature story, padded to `count` so every section has a
 * full field to sample regardless of how much the app has cached.
 *
 * Read once per mount rather than subscribed: the story is a fixed
 * composition, and covers swapping under a section mid-scroll would read as
 * a glitch rather than as motion.
 */
export function useShowcaseArtwork(count = 12): string[] {
  return useMemo(() => {
    const cached = cachedArtwork();
    if (cached.length >= count) return cached.slice(0, count);
    const padded = [...cached];
    for (let i = 0; padded.length < count; i += 1) {
      padded.push(fallbackCover(HUE_PRIORITY[i % HUE_PRIORITY.length]));
    }
    return padded;
  }, [count]);
}

/**
 * A small set chosen for maximum hue separation, for the section whose whole
 * point is that the material is never just grey. Falls back to generated
 * covers when the cache cannot supply enough genuinely different artwork.
 */
export function useContrastArtwork(count = 5): string[] {
  return useMemo(() => {
    const cached = cachedArtwork();
    // Spread the picks across the whole cache instead of taking the first
    // few, which on a home feed tend to come from one shelf and share a look.
    const stride = Math.max(1, Math.floor(cached.length / count));
    const spread: string[] = [];
    for (let i = 0; i < cached.length && spread.length < count; i += stride) {
      spread.push(cached[i]);
    }
    for (let i = 0; spread.length < count; i += 1) {
      spread.push(fallbackCover(HUE_PRIORITY[i % HUE_PRIORITY.length]));
    }
    return spread;
  }, [count]);
}
