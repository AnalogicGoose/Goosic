import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { HistoryIcon, SearchIcon, XIcon } from "lucide-react";
import { useSearchHistory } from "@/lib/store/search-history";
import type { SearchFilter } from "@/lib/innertube/search";
import { cn } from "@/lib/utils";

/** How many history entries the dropdown offers. */
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
 * The app's one search field, living in the title bar so it is reachable from
 * every page. It previously sat on /search, which meant search was only
 * available once you were already there.
 *
 * It reads the current route rather than taking the query as a prop, because it
 * now outlives any single page: on /search it stays in step with the URL in
 * both directions, and everywhere else it is simply a way in.
 */
export function SearchField({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });

  const onSearchRoute = location.pathname === "/search";
  const routeSearch = location.search as {
    q?: string;
    filter?: SearchFilter;
  };
  // Off /search there is no query to mirror, so the field reads as empty.
  const urlQ = onSearchRoute ? (routeSearch.q ?? "") : "";
  const filter: SearchFilter = onSearchRoute
    ? (routeSearch.filter ?? "all")
    : "all";

  const [value, setValue] = useState(urlQ);
  const debounced = useDebounced(value, 300);
  const userTypedRef = useRef(false);

  const history = useSearchHistory((s) => s.items);
  const pushHistory = useSearchHistory((s) => s.push);
  const clearHistory = useSearchHistory((s) => s.clear);

  // External URL changes flow into the input (clicking a history entry,
  // hitting Back, or navigating away from /search, which empties it).
  useEffect(() => {
    setValue(urlQ);
    userTypedRef.current = false;
  }, [urlQ]);

  // While on /search, mirror typing into the URL so results follow along.
  // Deliberately gated on being there already: doing it from anywhere else
  // would throw the user off the page they are on at the first keystroke.
  useEffect(() => {
    if (!userTypedRef.current || !onSearchRoute) return;
    if (debounced === urlQ) return;
    navigate({
      to: "/search",
      search: { q: debounced || undefined, filter },
      replace: true,
    });
  }, [debounced, urlQ, filter, navigate, onSearchRoute]);

  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Arriving at Search from the sidebar should drop the user straight into
  // typing — but only then. Focusing on every mount would steal the caret on
  // app launch and on every page change.
  useEffect(() => {
    if (onSearchRoute) inputRef.current?.focus();
  }, [onSearchRoute]);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return history.slice(0, HISTORY_LIMIT);
    return history
      .filter((h) => h.toLowerCase().includes(q) && h.toLowerCase() !== q)
      .slice(0, HISTORY_LIMIT);
  }, [history, value]);

  useEffect(() => {
    setActiveIdx(-1);
  }, [suggestions.length, focused]);

  const showDropdown = focused && suggestions.length > 0;

  const submitQuery = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushHistory(trimmed);
    userTypedRef.current = true;
    setValue(trimmed);
    setFocused(false);
    inputRef.current?.blur();
    navigate({ to: "/search", search: { q: trimmed, filter } });
  };

  const clear = () => {
    userTypedRef.current = true;
    setValue("");
    inputRef.current?.focus();
    // Only touch the URL when it is ours to touch.
    if (onSearchRoute) {
      navigate({
        to: "/search",
        search: { q: undefined, filter },
        replace: true,
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Explicit rather than relying on the form's implicit submission, which
      // needs a submit button or exactly one text field to be dependable
      // across the three WebViews Goosic ships on.
      e.preventDefault();
      submitQuery(
        activeIdx >= 0 && suggestions[activeIdx]
          ? suggestions[activeIdx]
          : value,
      );
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
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
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
          submitQuery(
            activeIdx >= 0 && suggestions[activeIdx]
              ? suggestions[activeIdx]
              : value,
          );
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search"
          aria-label="Search"
          value={value}
          onChange={(e) => {
            userTypedRef.current = true;
            setValue(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node | null))
              return;
            setFocused(false);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-6.5 w-full rounded-full border border-transparent bg-foreground/8 pl-8.5 pr-8 text-[13px] outline-none",
            "placeholder:text-muted-foreground",
            "transition-colors duration-150 hover:bg-foreground/12",
            "focus:border-foreground/20 focus:bg-foreground/15",
          )}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-1.5 top-1/2 flex size-4.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        ) : null}
      </form>

      {showDropdown && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md"
        >
          <ul className="py-1">
            {suggestions.map((h, i) => (
              <li key={h}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                    i === activeIdx ? "bg-accent" : "hover:bg-accent",
                  )}
                  onClick={() => submitQuery(h)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{h}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t">
            <button
              type="button"
              className="w-full cursor-pointer px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
              onClick={() => {
                clearHistory();
                setFocused(false);
                inputRef.current?.blur();
              }}
            >
              Clear search history
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
