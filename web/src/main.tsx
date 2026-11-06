import "./polyfills";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig, reconnect } from "./lib/near";
(window as any).React = React;
loadConfig().then(() => {
  reconnect();
  const s = document.createElement("script");
  s.src = "/ds/bundle.js";
  s.onload = () => createRoot(document.getElementById("root")!).render(<App />);
  document.head.appendChild(s);
});
