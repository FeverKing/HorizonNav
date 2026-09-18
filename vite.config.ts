import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 600 },
  server: { host: "127.0.0.1" },
});
