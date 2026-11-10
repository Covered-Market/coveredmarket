import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// `COVEREDMARKET_API=https://testnet.covered.market npm run dev` reads a deployed site's config and API instead of a local relayer.
const api = process.env.COVEREDMARKET_API;
export default defineConfig({ plugins: [react()], server: { proxy: api ? { "/api": { target: api, changeOrigin: true }, "/config.json": { target: api, changeOrigin: true } } : { "/api": "http://localhost:8787" } } });
