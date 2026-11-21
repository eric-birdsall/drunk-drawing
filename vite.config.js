import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";

// Version and "last updated" stamp for the main menu, read from git at build
// time so every commit (and every Pages deploy) updates it automatically.
// Version is package.json's major.minor plus the commit count as the patch.
const git = (cmd, fallback) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
};
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const [major, minor] = version.split(".");
const build = {
  version: `${major}.${minor}.${git("rev-list --count HEAD", "0")}`,
  commit: git("rev-parse --short HEAD", ""),
  date: git("log -1 --format=%cI", new Date().toISOString()),
};

export default {
  plugins: [VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.js",
    injectRegister: false,
    registerType: "prompt",
    manifest: {
      name: "Drunk Drawing",
      short_name: "Drunk Drawing",
      description: "A same-room drawing and guessing game.",
      id: "./",
      start_url: "./",
      scope: "./",
      display: "standalone",
      theme_color: "#161b1a",
      background_color: "#161b1a",
      icons: [192, 512].map(size => ({
        src: `icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any",
      })),
    },
    injectManifest: {
      globPatterns: ["**/*.{html,js,css,png,jpg,jpeg,svg,webp,ico,mp3,wav,ogg,m4a,woff,woff2,ttf,glb,gltf,bin,json,webmanifest}"],
      maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
    },
  })],
  server: {
    port: 5174,
  },
  define: {
    __BUILD__: JSON.stringify(build),
  },
};
