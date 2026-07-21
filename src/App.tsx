import { RouterProvider, createRouter } from "@tanstack/react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "next-themes";
import {
  PERSIST_MAX_AGE,
  fitsInPersistBudget,
  persister,
  queryClient,
  shouldPersistQuery,
} from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { isFloatingPlayerWindow } from "@/lib/floating-player";
import FloatingPlayerApp from "@/components/layout/floating-player-app";
import { useSettingsStore } from "@/lib/store/settings";
import { useGlassBlur, useVisualTheme } from "@/lib/themes";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  const visualTheme = useSettingsStore((state) => state.visualTheme);
  const glassBlur = useSettingsStore((state) => state.glassBlur);
  useVisualTheme(visualTheme);
  useGlassBlur(glassBlur);

  // The same Vite bundle is loaded in both windows; the standalone
  // floating player skips routing/shell entirely.
  if (isFloatingPlayerWindow()) {
    return <FloatingPlayerApp />;
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      // Light mode is deprecated — the app is dark-only. `forcedTheme`
      // pins the class on <html> regardless of any persisted/system
      // preference, so every `dark:` utility and `.dark`-scoped rule
      // stays active and no light styling is ever reachable.
      forcedTheme="dark"
      storageKey="ytm-theme"
      disableTransitionOnChange
    >
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) =>
              q.state.status === "success" &&
              shouldPersistQuery(q.queryKey) &&
              fitsInPersistBudget(q.state.data),
          },
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </ThemeProvider>
  );
}
