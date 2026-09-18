import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type UpdateStatus = {
  checkedAt: string;
  currentVersion: string;
  installedCommit: string | null;
  latestVersion: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  comparison: "commit" | "version" | "unknown";
  updateCommand: string;
  message: string;
  error?: string;
};

const DISMISS_PREFIX = "applylite:update-dismissed:";

function dismissalKey(status: UpdateStatus) {
  return `${DISMISS_PREFIX}${status.latestCommit || status.latestVersion || "unknown"}`;
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  async function check(force = false) {
    try {
      const next = await api<UpdateStatus>(`/system/update-status${force ? "?force=1" : ""}`);
      setStatus(next);
      setDismissed(next.updateAvailable ? localStorage.getItem(dismissalKey(next)) === "1" : false);
    } catch {
      // Update checks are advisory and should never block the local application.
    }
  }

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 10 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const remoteIdentity = useMemo(() => status?.latestCommit || status?.latestVersion || null, [status]);

  async function copyCommand() {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.updateCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function dismiss() {
    if (!status || !remoteIdentity) return;
    localStorage.setItem(dismissalKey(status), "1");
    setDismissed(true);
  }

  if (!status?.updateAvailable || dismissed) return null;

  return (
    <section className="update-banner" role="alert" aria-label="ApplyLite update available">
      <div className="update-banner-copy">
        <strong>New ApplyLite update available{status.latestVersion ? ` · v${status.latestVersion}` : ""}</strong>
        <span>Close ApplyLite, then run the update command. This notice will return automatically when another new version is merged.</span>
        <code>{status.updateCommand}</code>
      </div>
      <div className="update-banner-actions">
        <button type="button" onClick={copyCommand}>{copied ? "Copied" : "Copy update command"}</button>
        <button type="button" className="update-banner-dismiss" onClick={dismiss} aria-label="Dismiss this update notice">Dismiss ×</button>
      </div>
    </section>
  );
}
