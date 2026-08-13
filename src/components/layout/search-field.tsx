import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HistoryIcon, SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
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
 * The Search page's input, with its history dropdown.
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
  const userTypedRef = useRef(false);

  const history = useSearchHistory((s) => s.items);
  const pushHistory = useSearchHistory((s) => s.push);
  const clearHistory = useSearchHistory((s) => s.clear);

  // External URL changes flow into the input (e.g. clicking a history
  // entry that calls navigate, or hitting Back).
  useEffect(() => {
    setValue(urlQ);
    userTypedRef.current = false;
  }, [urlQ]);

  // As the user types, mirror the value into the URL so the route re-runs the
  // search query. Replace history while staying on /search so Back returns to
  // whatever page got the user here, not every keystroke.
  useEffect(() => {
    if (!userTypedRef.current) return;
    if (debounced === urlQ) return;
    navigate({
      to: "/search",
      search: { q: debounced || undefined, filter },
      replace: true,
    });
  }, [debounced, urlQ, filter, navigate]);

  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus whenever the route mounts, so opening Search from the sidebar
  // drops the user straight into typing.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    navigate({
      to: "/search",
      search: { q: undefined, filter },
      replace: true,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
          if (activeIdx >= 0 && suggestions[activeIdx]) {
            submitQuery(suggestions[activeIdx]);
          } else {
            submitQuery(value);
          }
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
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <ul className="py-1">
            {suggestions.map((h, i) => (
              <li key={h}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm",
                    i === activeIdx ? "bg-accent" : "hover:bg-accent",
                  )}
                  onClick={() => submitQuery(h)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
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
