import { useSyncExternalStore } from "react";
export const views = ["dashboard","daily","review","applications","gmail","coach","outcomes","discover","growth","cv","profile","answers","system"] as const;
export type View = typeof views[number];
export function viewFromPath(path: string): View | null {
  const value = path.replace(/^\/+|\/+$/g, "") || "dashboard";
  return (views as readonly string[]).includes(value) ? value as View : null;
}
const subscribe = (cb: () => void) => { window.addEventListener("popstate", cb); window.addEventListener("applylite:navigate", cb); return () => { window.removeEventListener("popstate", cb); window.removeEventListener("applylite:navigate", cb); }; };
const snapshot = () => window.location.pathname + window.location.search + window.location.hash;
export function useLocation() { return useSyncExternalStore(subscribe,snapshot); }
export function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("Navigation must stay local.");
  if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
  window.dispatchEvent(new Event("applylite:navigate"));
}
/** Run after an explicit user action, never on every polling update. */
export function guideTo(id: string) {
  window.setTimeout(() => {
    const section = document.getElementById(id);
    if (!section) return;
    const controls = "input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])";
    // Selector alternatives follow document order, not priority. Check missing
    // fields separately so a valid name field cannot steal the next-step focus.
    const target = section.matches(controls) ? section
      : section.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled])')
        || section.querySelector<HTMLElement>(controls) || section;
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
    target.classList.add("next-step-highlight");
    target.focus({ preventScroll: true });
    window.setTimeout(() => target.classList.remove("next-step-highlight"), 2500);
  }, 80);
}
