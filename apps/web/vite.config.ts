import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3001,
    // Test fixtures use the app origin to reach its isolated Worker.
    proxy: process.env.KOUSA_E2E_API_URL
      ? {
          "/api/auth": process.env.KOUSA_E2E_API_URL,
          "/rpc": process.env.KOUSA_E2E_API_URL,
          "/api-reference": process.env.KOUSA_E2E_API_URL,
        }
      : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
