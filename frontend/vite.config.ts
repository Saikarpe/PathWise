// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only, preset below), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pinned to Vercel now that this deploys on its own rather than through
  // Lovable's Cloudflare-targeted pipeline. Nitro would auto-detect the
  // right target from the deploy platform's own env vars regardless, but
  // pinning it removes that as a variable — `npm run build` always produces
  // Vercel-shaped output, on this machine or in Vercel's own build step.
  nitro: { preset: "vercel" },
});
