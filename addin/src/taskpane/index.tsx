import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import "./taskpane.css";

/* global document, Office */

const rootElement: HTMLElement | null = document.getElementById("container");
const root = rootElement ? createRoot(rootElement) : undefined;

Office.onReady(() => {
  root?.render(<App />);
});
