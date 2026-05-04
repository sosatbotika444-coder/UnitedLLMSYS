import React from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmDialogProvider } from "./feedback";
import "./styles.css";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfirmDialogProvider>
      <App />
    </ConfirmDialogProvider>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("United Lane service worker registration failed", error);
    });
  });
}

