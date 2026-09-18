import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 600 },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:5175", changeOrigin: true } },
  },
});
