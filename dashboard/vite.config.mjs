import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
    // The loopback server deliberately keeps font-src restricted to self.
    // Emit even small font subsets as files instead of CSP-blocked data URLs.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Keep stable framework and icon code cacheable across dashboard releases.
        // Feature-heavy poster/export code is split separately through React.lazy.
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-dom/client"],
          "icons-vendor": ["lucide-react"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
