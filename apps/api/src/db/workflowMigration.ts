import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/** Additive migration. A failed snapshot is a stop condition, not silent permission to migrate. */
export function migrateWorkflow(db: Database.Database, databasePath: string) {
  const version = Number(db.pragma("user_version", { simple: true }));
  if (version >= 11) return;
  if (process.env.APPLYLITE_TEST_MODE !== "true") {
    const folder = path.join(path.dirname(databasePath), "migration-backups");
    fs.mkdirSync(folder, { recursive: true });
    const snapshot = path.join(folder, `before-workflow-11-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
    if (!fs.statSync(snapshot).size) throw new Error("Workflow migration backup was empty. Migration stopped.");
  }
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_tasks (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED', phase TEXT NOT NULL DEFAULT 'QUEUED',
        input_json TEXT NOT NULL, counters_json TEXT NOT NULL DEFAULT '{}', result_json TEXT,
        message TEXT NOT NULL DEFAULT '', error_code TEXT, error_message TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0, lease TEXT, retry_of TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_task_active ON workflow_tasks(kind, subject_key)
        WHERE status IN ('QUEUED','RUNNING','CANCELLING');
      CREATE TABLE IF NOT EXISTS discovery_run_jobs (
        run_id INTEGER NOT NULL, job_id INTEGER NOT NULL, PRIMARY KEY(run_id,job_id),
        FOREIGN KEY(run_id) REFERENCES discovery_runs(id) ON DELETE CASCADE,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS cv_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT NOT NULL, source_type TEXT NOT NULL,
        raw_text TEXT NOT NULL, facts_json TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1, published_cv_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const columns: Record<string,string> = {
      score_kind: "TEXT NOT NULL DEFAULT 'legacy'", analysis_status: "TEXT NOT NULL DEFAULT 'unknown'",
      pre_score: "REAL", discovered_at: "TEXT", score_cv_id: "INTEGER", score_profile_hash: "TEXT"
    };
    const existing = new Set((db.prepare("PRAGMA table_info(jobs)").all() as {name:string}[]).map(c => c.name));
    for (const [name, definition] of Object.entries(columns)) if (!existing.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version,description) VALUES(11,?)")
      .run("CV workflow: persistent tasks, onboarding, AI preferences and discovery provenance");
    db.pragma("user_version = 11");
  })();
}
