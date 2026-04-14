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
}));
