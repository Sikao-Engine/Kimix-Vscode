import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

declare global {
  interface Window {
    acquireVsCodeApi(): import("./types").VSCodeAPI;
  }
}

if (import.meta.env.DEV && typeof window.acquireVsCodeApi !== "function") {
  const { installMock } = await import("./debug/mock-vscode");
  installMock();
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
