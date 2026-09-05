import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.CASTORICEUI_DEV_API_TARGET || "http://127.0.0.1:18080";
const parsedTarget = new URL(apiTarget);
if (
  parsedTarget.protocol !== "http:" ||
  !["127.0.0.1", "::1", "localhost"].includes(parsedTarget.hostname) ||
  parsedTarget.username ||
  parsedTarget.password ||
  parsedTarget.pathname !== "/" ||
  parsedTarget.search ||
  parsedTarget.hash
) {
  throw new Error("CASTORICEUI_DEV_API_TARGET must be an HTTP loopback URL");
}

export default defineConfig({
  plugins: [basicSsl(), react()],
  server: {
    host: "127.0.0.1",
    https: {},
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    target: ["chrome111", "edge111", "firefox113", "safari16.2"],
    cssTarget: "safari16.2",
    sourcemap: false,
  },
});
