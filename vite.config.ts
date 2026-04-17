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
    proxy: {
      // Local proxy for eofficeportal API — runs in Node.js (same machine as browser)
      // so it can reach eofficeportal.com and bypass the expired SSL cert.
      // This avoids CORS issues and does not depend on Supabase cloud connectivity.
      "/api/eoffice": {
        target: "https://eofficeportal.com",
        changeOrigin: true,
        secure: false,          // bypass expired SSL cert
        rewrite: () =>
          "/Company/SmartService.asmx/FillCustomerlist" +
          "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf",
      },
    },
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
