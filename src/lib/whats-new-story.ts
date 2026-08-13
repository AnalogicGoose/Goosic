/**
 * Which releases replace the bullet-list What's New screen with a full
 * feature story.
 *
 * Kept out of `WhatsNewEntry` on purpose: `resolveWhatsNewEntry` prefers the
 * notes GitHub returns over the bundled ones, so a field living on the entry
 * would vanish the moment a release carried its own body. Keying off the
 * version instead means the story survives whichever source wins.
 */
const STORY_VERSIONS = new Set(["0.7.0"]);

export function hasGlassStory(version: string | null | undefined): boolean {
  return !!version && STORY_VERSIONS.has(version);
}
