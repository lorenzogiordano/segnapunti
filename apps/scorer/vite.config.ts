import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

/** Fills the service worker with the list of built files, so the whole app works offline. */
function offlineFiles(): Plugin {
  return {
    name: "offline-files",
    apply: "build",
    closeBundle() {
      const dist = join(import.meta.dirname, "dist");
      const sw = join(dist, "sw.js");
      const files = allFiles(dist).filter((f) => f !== sw);
      const hash = createHash("sha256");
      for (const file of files) hash.update(readFileSync(file));
      const list = ["./", ...files.map((f) => relative(dist, f))];
      const code = readFileSync(sw, "utf8")
        .replace("__VERSION__", hash.digest("hex").slice(0, 12))
        .replace('"__FILES__"', JSON.stringify(list));
      writeFileSync(sw, code);
    },
  };
}

export default defineConfig({
  base: "/segnapunti/",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: ["safari15", "chrome100"] },
  plugins: [offlineFiles()],
});
