// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "0.0.0.0", port: 4321 },
  devToolbar: { enabled: false },
  // ddev serves this at books.ddev.site; vite blocks unknown hosts by default.
  vite: { server: { allowedHosts: [".ddev.site", "localhost"] } },
});
