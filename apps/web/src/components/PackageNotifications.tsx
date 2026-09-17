import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/navigation";

type PrepStatus = "QUEUED" | "GENERATING" | "READY" | "NEEDS_REVIEW" | "FAILED" | "SUBMITTED" | "DISMISSED" | "SKIPPED";
type PrepItem = {
  id: number;
  jobId: number;
  status: PrepStatus;
  title: string;
  company: string;
  errorMessage: string | null;
};
type PackageWatch = {
  id: number;
  jobId: number;
  title: string;
  company: string;
  notifiedStatus?: string;
};

const STORAGE_KEY = "applylite:package-watches-v1";
const ACTIVE = new Set<PrepStatus>(["QUEUED", "GENERATING"]);
const DONE = new Set<PrepStatus>(["READY", "NEEDS_REVIEW", "FAILED"]);

function readWatches(): PackageWatch[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => Number.isInteger(item?.id)) : [];
  } catch {
    return [];
  }
}

function writeWatches(items: PackageWatch[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("applylite:package-watch"));
}

export function watchPackageGeneration(input: Omit<PackageWatch, "notifiedStatus">) {
  const current = readWatches().filter((item) => item.id !== input.id);
  writeWatches([{ ...input }, ...current].slice(0, 20));
}

export function PackageNotifications() {
  const [watches, setWatches] = useState<PackageWatch[]>(() => readWatches());
  const [items, setItems] = useState<Record<number, PrepItem>>({});

  useEffect(() => {
    const refresh = () => setWatches(readWatches());
    window.addEventListener("applylite:package-watch", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("applylite:package-watch", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!watches.length) return;
    let alive = true;
    let timer: number | undefined;

    const poll = async () => {
      const nextItems: Record<number, PrepItem> = {};
      let nextWatches = [...watches];
      let watchChanged = false;
      let hasActive = false;

      for (const watch of watches) {
        try {
          const item = await api<PrepItem>(`/application-prep/items/${watch.id}`);
          if (!alive) return;
          nextItems[item.id] = item;
          hasActive ||= ACTIVE.has(item.status);

          if (DONE.has(item.status) && watch.notifiedStatus !== item.status) {
            nextWatches = nextWatches.map((value) => value.id === watch.id ? { ...value, notifiedStatus: item.status } : value);
            watchChanged = true;
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(item.status === "FAILED" ? "ApplyLite package failed" : "ApplyLite package ready", {
                body: item.status === "FAILED"
                  ? `${item.title} at ${item.company}: generation needs attention.`
                  : `${item.title} at ${item.company} is ready to review.`
              });
            }
          }
        } catch {
          // The queue item may have been removed during recovery. Keep the watch;
          // a later poll can reconnect without losing the user's completion alert.
          hasActive = true;
        }
      }

      if (!alive) return;
      setItems(nextItems);
      if (watchChanged) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWatches));
        setWatches(nextWatches);
      }
      timer = window.setTimeout(poll, hasActive ? 2500 : 12000);
    };

    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [watches.map((item) => `${item.id}:${item.notifiedStatus || ""}`).join("|")]);

  const visible = useMemo(() => watches
    .map((watch) => ({ watch, item: items[watch.id] }))
    .filter(({ item }) => item && (ACTIVE.has(item.status) || DONE.has(item.status)))
    .slice(0, 3), [watches, items]);

  function dismiss(id: number) {
    writeWatches(readWatches().filter((item) => item.id !== id));
  }

  if (!visible.length) return null;
  return (
    <div className="package-notification-stack" aria-live="polite" aria-label="Application package activity">
      {visible.map(({ watch, item }) => {
        const ready = item.status === "READY" || item.status === "NEEDS_REVIEW";
        const failed = item.status === "FAILED";
        return (
          <article className={`package-notification ${ready ? "ready" : failed ? "failed" : "working"}`} key={watch.id}>
            <div>
              <span className="eyebrow">{ready ? "PACKAGE READY" : failed ? "PACKAGE NEEDS ATTENTION" : "GENERATING PACKAGE"}</span>
              <strong>{watch.title}</strong>
              <small>{watch.company}</small>
              {!ready && !failed && <p>ApplyLite is working in the background. Keep browsing jobs; you do not need to keep the Dashboard open.</p>}
              {ready && <p>Your tailored CV and cover letter are ready for review.</p>}
              {failed && <p>{item.errorMessage || "Generation failed. Open the Review Queue to retry."}</p>}
            </div>
            <div className="package-notification-actions">
              {ready && <button className="primary" onClick={() => navigate("/review")}>Review package</button>}
              {failed && <button onClick={() => navigate("/review")}>Open Review Queue</button>}
              {!ready && !failed && <button onClick={() => navigate("/discover")}>Browse jobs</button>}
              <button onClick={() => dismiss(watch.id)}>Dismiss</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
