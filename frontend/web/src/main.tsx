import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./tw.css";

// The page is already rendered into the HTML at build time; this only wires up the copy button.
hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <App />
  </StrictMode>,
);
