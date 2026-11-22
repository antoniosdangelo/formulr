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

// Light motion, added only in the browser: sections ease in once as they scroll into view, and the
// top bar gets a hairline shadow after scrolling. Skipped for people who ask for reduced motion.
if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const root = document.documentElement;
  root.classList.add("motion");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  document.querySelectorAll("main > section.wrap:not(.hero)").forEach((el) => io.observe(el));
}
const top = document.querySelector(".top");
const onScroll = () => top?.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();
