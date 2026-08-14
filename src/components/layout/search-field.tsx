import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MENU_GLASS_SURFACE_CLASS } from "@/components/ui/glass-surface";
import { Thumbnail } from "@/components/shared/thumbnail";
import { useSearchHistory } from "@/lib/store/search-history";
import {
  fetchSearchSuggestions,
  type SearchFilter,
} from "@/lib/innertube/search";
import type { ShelfItem } from "@/lib/innertube/types";
import { cn } from "@/lib/utils";

/** How many past queries the dropdown offers when the field is empty. */
const HISTORY_LIMIT = 5;

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * One row of the dropdown. History and live completions are both "run this
 * query"; entities are a concrete artist/album/playlist to open.
 */
type Entry =
  | { type: "history"; query: string }
  | { type: "query"; query: string }
  | { type: "entity"; item: ShelfItem };

const entryKey = (e: Entry, i: number) =>
  e.type === "entity"
    ? `e-${e.item.kind}-${e.item.id}-${i}`
    : `${e.type}-${e.query}`;

/**
 * The Search page's input, with its suggestion dropdown.
 *
 * Deliberately scoped to that page rather than living in the title bar: search
 * is a place you go, not a control that follows you around. It lives in its own
 * file only because it is large enough to crowd the route otherwise.
 */
export function SearchField({
  filter,
  urlQ,
  className,
}: {
  filter: SearchFilter;
  urlQ: string;
  className?: string;
}) {
  const navigate = useNavigate();

  const [value, setValue] = useState(urlQ);
  const debounced = useDebounced(value, 300);

  const history = useSearchHistory((s) => s.items);
  const pushHistory = useSearchHistory((s) => s.push);
  const clearHistory = useSearchHistory((s) => s.clear);

  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // External URL changes flow into the input (e.g. clicking a history
  // entry that calls navigate, or hitting Back).
  useEffect(() => {
    setValue(urlQ);
  }, [urlQ]);

  // Typing deliberately does NOT run the search. The value used to be mirrored
  // into the URL on a debounce, which re-ran the route's query on every pause —
  // so a half-typed word issued a real search, and the results churned
  // underneath the suggestions. Searching is now an explicit act: Enter, or
  // picking a row from the dropdown. The debounced value still drives
  // suggestions, which are cheap and are the point of typing.

  // Auto-focus whenever the route mounts, so opening Search from the sidebar
  // drops the user straight into typing.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const typed = debounced.trim();
  // Keyed on the debounced value, so a request goes out per pause rather than
  // per keystroke. Completions for a given prefix don't change minute to
  // minute, and re-typing one is common, so they are worth caching.
  const suggestQuery = useQuery({
    queryKey: ["search-suggestions", typed],
    queryFn: () => fetchSearchSuggestions(typed),
    enabled: focused && typed.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const entries = useMemo<Entry[]>(() => {
    const q = value.trim().toLowerCase();

    // Nothing typed: the dropdown is a shortcut back to what you searched
    // before, which is all we can usefully offer.
    if (!q) {
      return history
        .slice(0, HISTORY_LIMIT)
        .map((query) => ({ type: "history", query }) as const);
    }

    // Local history first — it is instant and it is yours — then whatever the
    // remote turned up, minus anything already covered by a history row.
    const matchingHistory = history
      .filter((h) => h.toLowerCase().includes(q) && h.toLowerCase() !== q)
      .slice(0, 3)
      .map((query) => ({ type: "history", query }) as const);

    const seen = new Set(matchingHistory.map((h) => h.query.toLowerCase()));
    const remote: Entry[] = [];
    for (const s of suggestQuery.data ?? []) {
      if (s.kind === "query") {
        const key = s.query.toLowerCase();
        if (key === q || seen.has(key)) continue;
        seen.add(key);
        remote.push({ type: "query", query: s.query });
      } else {
        remote.push({ type: "entity", item: s.item });
      }
    }

    return [...matchingHistory, ...remote];
  }, [history, value, suggestQuery.data]);

  useEffect(() => {
    setActiveIdx(-1);
  }, [entries.length, focused]);

  const showDropdown = focused && entries.length > 0;

  const submitQuery = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushHistory(trimmed);
    setValue(trimmed);
    setFocused(false);
    inputRef.current?.blur();
    navigate({ to: "/search", search: { q: trimmed, filter } });
  };

  /**
   * Artists, albums and playlists have pages of their own, so a suggestion for
   * one goes straight there — skipping a results page the user would only have
   * clicked through. Songs and videos have no page; searching their title puts
   * them at the top of the results instead.
   */
  const openEntity = (item: ShelfItem) => {
    setFocused(false);
    inputRef.current?.blur();
    if (item.kind === "artist") {
      void navigate({ to: "/artist/$id", params: { id: item.id } });
      return;
    }
    if (item.kind === "album") {
      void navigate({ to: "/album/$id", params: { id: item.id } });
      return;
    }
    if (item.kind === "playlist") {
      void navigate({ to: "/playlist/$id", params: { id: item.id } });
      return;
    }
    submitQuery(item.title);
  };

  const choose = (entry: Entry) => {
    if (entry.type === "entity") openEntity(entry.item);
    else submitQuery(entry.query);
  };

  const clear = () => {
    setValue("");
    inputRef.current?.focus();
    navigate({
      to: "/search",
      search: { q: undefined, filter },
      replace: true,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Handled here rather than left to the form's implicit submission. That
      // depends on a submit button or exactly one text field, and Enter is now
      // the only way to run a search — not worth leaving to a rule the three
      // WebViews interpret differently.
      e.preventDefault();
      const active = activeIdx >= 0 ? entries[activeIdx] : undefined;
      if (active) choose(active);
      else submitQuery(value);
      return;
    }
    if (e.key === "Escape") {
      if (value) {
        clear();
        return;
      }
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const active = activeIdx >= 0 ? entries[activeIdx] : undefined;
          if (active) choose(active);
          else submitQuery(value);
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search songs, albums, artists…"
          // A pill rather than a rounded rectangle: this is the page's primary
          // control, and the shape matches the scope toggle beside it.
          className="h-10 rounded-full pl-10 pr-10"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node | null))
              return;
            setFocused(false);
          }}
          onKeyDown={onKeyDown}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </form>

      {showDropdown && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "menu-shell-clip absolute left-0 right-0 top-full z-50 mt-2 surface-menu py-2 text-popover-foreground",
            MENU_GLASS_SURFACE_CLASS,
          )}
        >
          <ul>
            {entries.map((entry, i) => (
              <li key={entryKey(entry, i)}>
                <button
                  type="button"
                  className={cn(
                    "mx-2 flex w-[calc(100%-1rem)] cursor-pointer items-center gap-3 surface-item px-3 text-left transition-colors",
                    entry.type === "entity" ? "py-1.5" : "py-2",
                    i === activeIdx ? "bg-accent" : "hover:bg-accent",
                  )}
                  onClick={() => choose(entry)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  {entry.type === "entity" ? (
                    <>
                      <Thumbnail
                        thumbnails={entry.item.thumbnails}
                        alt={entry.item.title}
                        targetSize={64}
                        className={cn(
                          "size-8 shrink-0 border border-hairline",
                          entry.item.kind === "artist"
                            ? "rounded-full"
                            : "rounded",
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">
                          {entry.item.title}
                        </span>
                        {entry.item.subtitle ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {entry.item.subtitle}
                          </span>
                        ) : null}
                      </span>
                    </>
                  ) : (
                    <>
                      {entry.type === "history" ? (
                        <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm">{entry.query}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {history.length > 0 ? (
            <div className="mt-1 pt-1">
              <button
                type="button"
                className="mx-2 w-[calc(100%-1rem)] cursor-pointer surface-item px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
                onClick={() => {
                  clearHistory();
                  setFocused(false);
                  inputRef.current?.blur();
                }}
              >
                Clear search history
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
