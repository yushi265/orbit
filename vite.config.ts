import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localViteOptions } from "./scripts/local.mjs";

const local = localViteOptions();

export default defineConfig({
  ...(local ? { envDir: false as const } : {}),
  server: local?.server ?? { port: 3000 },
  plugins: [
    local?.urlPlugin,
    cloudflare({ ...local?.cloudflare, viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
  ],
});
