import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    // The eofficeportal dev proxy (and its hardcoded access-token query string)
    // that used to live here has been removed — the frontend now goes exclusively
    // through the authenticated Supabase edge function `customer-sync`, which
    // reads its token from a Supabase secret. See supabase/functions/customer-sync
    // for the current implementation.
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    // Split vendor libraries into separate cacheable chunks so the browser
    // can load them in parallel and cache them independently of app code.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase"))          return "vendor-supabase";
          if (id.includes("@tanstack"))           return "vendor-query";
          if (id.includes("@radix-ui") ||
              id.includes("lucide-react") ||
              id.includes("cmdk") ||
              id.includes("vaul"))                return "vendor-ui";
          if (id.includes("date-fns") ||
              id.includes("xlsx") ||
              id.includes("canvas-confetti"))     return "vendor-utils";
          if (id.includes("react-router") ||
              id.includes("react-dom") ||
              id.includes("/react/"))             return "vendor-react";
        },
      },
    },
  },
}));
