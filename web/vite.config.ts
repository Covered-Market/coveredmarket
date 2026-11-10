import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// COVEREDMARKET_API=https://testnet.covered.market runs the dev server against a deployed app's /api and /config.json.
const remote = process.env.COVEREDMARKET_API;
const proxy = remote
  ? { "/api": { target: remote, changeOrigin: true }, "/config.json": { target: remote, changeOrigin: true } }
  : { "/api": "http://localhost:8787" };
export default defineConfig({ plugins: [react()], server: { proxy } });
