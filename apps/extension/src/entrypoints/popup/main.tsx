import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./popup.css";

// Polyfill `global` for @clerk/chrome-extension's getClerkJsEntryChunk, which
// references `global.Clerk` as a free variable. The same polyfill normally
// ships with @clerk/ui's register chunk that gets pulled in by modal-mode
// SignInButton/SignUpButton imports — we open dashboard sign-in in a new tab
// instead, which tree-shakes that chunk and leaves the bare `global` refs to
// throw ReferenceError on popup mount.
{
  const g = globalThis as typeof globalThis & { global?: typeof globalThis };
  if (typeof g.global === "undefined") g.global = globalThis;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("popup root element missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
