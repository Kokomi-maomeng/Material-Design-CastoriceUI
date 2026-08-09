import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2017",
    cssTarget: "safari13",
    sourcemap: false,
  },
});
