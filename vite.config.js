import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Ne précache pas les fichiers lourds copiés depuis public/wasm/*
        globIgnores: ["**/wasm/**", "**/*.map"],
        // Ne précache que les types d’assets utiles
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
        // (optionnel) pour relever la limite si tu en as besoin :
        // maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: "PaperMarty",
        short_name: "PaperMarty",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0b0b",
        theme_color: "#0b0b0b",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
