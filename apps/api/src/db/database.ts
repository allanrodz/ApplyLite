import { migrateWorkflow } from "./workflowMigration.js";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

const dbPath = path.resolve(process.cwd(), config.databasePath);
const storagePath = path.resolve(process.cwd(), config.storagePath);
const maintenanceRoot = path.resolve(process.cwd(), ".maintenance");
const pendingRestoreMarker = path.join(maintenanceRoot, "restore-pending.json");
const pendingRestoreRoot = path.join(maintenanceRoot, "restore-pending-data");
const M9_SCHEMA_VERSION = 9;
const M10_SCHEMA_VERSION = 10;

function applyPendingRestore() {
  if (!fs.existsSync(pendingRestoreMarker)) return;
  const pendingDb = path.join(pendingRestoreRoot, "data", "apply-lite.db");
  if (!fs.existsSync(pendingDb)) {
    fs.rmSync(pendingRestoreMarker, { force: true });
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const recoveryRoot = path.resolve(process.cwd(), "backups", "recovery", stamp);
  fs.mkdirSync(recoveryRoot, { recursive: true });
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, path.join(recoveryRoot, "apply-lite-before-restore.db"));
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.copyFileSync(pendingDb, dbPath);

  const pendingStorage = path.join(pendingRestoreRoot, "storage");
  if (fs.existsSync(pendingStorage)) {
    if (fs.existsSync(storagePath)) fs.cpSync(storagePath, path.join(recoveryRoot, "storage-before-restore"), { recursive: true, force: true });
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.cpSync(pendingStorage, storagePath, { recursive: true, force: true });
  }

  fs.rmSync(pendingRestoreRoot, { recursive: true, force: true });
  fs.rmSync(pendingRestoreMarker, { force: true });
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
applyPendingRestore();

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function hasColumn(table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function ensureJobColumns() {
  if (!hasColumn("jobs", "analysis_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!hasColumn("jobs", "source_text")) {
    db.exec("ALTER TABLE jobs ADD COLUMN source_text TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn("jobs", "ats")) {
    db.exec("ALTER TABLE jobs ADD COLUMN ats TEXT NOT NULL DEFAULT 'unknown'");
  }
  if (!hasColumn("jobs", "origin")) {
    db.exec("ALTER TABLE jobs ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'");
  }
}


function ensureGeneratedArtifactColumns() {
  if (!hasColumn("generated_artifacts", "package_id")) {
    db.exec("ALTER TABLE generated_artifacts ADD COLUMN package_id INTEGER");
  }
}

function ensureDiscoveryRunColumns() {
  const columns: Array<[string, string]> = [
    ["cache_hits", "INTEGER NOT NULL DEFAULT 0"],
    ["ai_requests", "INTEGER NOT NULL DEFAULT 0"],
    ["duration_ms", "INTEGER NOT NULL DEFAULT 0"],
    ["source_fetch_ms", "INTEGER NOT NULL DEFAULT 0"],
    ["analysis_ms", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [column, definition] of columns) {
    if (!hasColumn("discovery_runs", column)) {
      db.exec(`ALTER TABLE discovery_runs ADD COLUMN ${column} ${definition}`);
    }
  }
}

function ensureApplicationTrackerColumns() {
  const columns: Array<[string, string]> = [
    ["outcome", "TEXT NOT NULL DEFAULT 'ACTIVE'"],
    ["submitted_at", "TEXT"],
    ["outcome_at", "TEXT"],
    ["next_action_at", "TEXT"],
    ["next_action", "TEXT NOT NULL DEFAULT ''"],
    ["notes", "TEXT NOT NULL DEFAULT ''"],
    ["submitted_score", "INTEGER"]
  ];
  for (const [column, definition] of columns) {
    if (!hasColumn("applications", column)) {
      db.exec(`ALTER TABLE applications ADD COLUMN ${column} ${definition}`);
    }
  }

  // Backfill applications submitted before M5 so the tracker starts with useful history.
  db.exec(`
    UPDATE applications
    SET outcome = 'WAITING'
    WHERE state = 'SUBMITTED' AND (outcome IS NULL OR outcome = 'ACTIVE');

    UPDATE applications
    SET submitted_at = COALESCE(submitted_at, updated_at)
    WHERE state = 'SUBMITTED';

    UPDATE applications
    SET submitted_score = COALESCE(
      submitted_score,
      (SELECT score FROM jobs WHERE jobs.id = applications.job_id)
    )
    WHERE state = 'SUBMITTED';
  `);
}


function createPreMigrationSnapshot(targetVersion: number) {
  if (process.env.APPLYLITE_TEST_MODE === "true") return null;
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (currentVersion >= targetVersion) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const migrationDir = path.resolve(process.cwd(), "backups", "migrations");
  fs.mkdirSync(migrationDir, { recursive: true });
  const snapshot = path.join(migrationDir, `apply-lite-before-schema-${targetVersion}-${stamp}.db`);
  try {
    db.pragma("wal_checkpoint(FULL)");
    const escaped = snapshot.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    return snapshot;
  } catch {
    return null;
  }
}

function runM9Migration() {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (currentVersion >= M9_SCHEMA_VERSION) return;
  const snapshot = createPreMigrationSnapshot(M9_SCHEMA_VERSION);
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS maintenance_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_maintenance_events_created
        ON maintenance_events(created_at DESC);
    `);
    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, description, applied_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(M9_SCHEMA_VERSION, "M9 production hardening: backups, doctor, recovery, exports and migration framework");
  });
  migrate();
  db.pragma(`user_version = ${M9_SCHEMA_VERSION}`);
  try {
    db.prepare(`INSERT INTO maintenance_events (kind, status, message, details_json) VALUES ('migration', 'PASS', ?, ?)`)
      .run(`Schema upgraded to version ${M9_SCHEMA_VERSION}.`, JSON.stringify({ snapshot }));
  } catch {
    // Migration itself already succeeded; diagnostics are best-effort.
  }
}

function runM10Migration() {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (currentVersion >= M10_SCHEMA_VERSION) return;
  const snapshot = createPreMigrationSnapshot(M10_SCHEMA_VERSION);
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS gmail_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        connected_email TEXT NOT NULL DEFAULT '',
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL DEFAULT 15,
        lookback_days INTEGER NOT NULL DEFAULT 30,
        last_sync_at TEXT,
        last_sync_started_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO gmail_settings (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS gmail_messages (
        gmail_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL DEFAULT '',
        rfc_message_id TEXT NOT NULL DEFAULT '',
        from_email TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        to_email TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        snippet TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        received_at TEXT NOT NULL,
        internal_date INTEGER NOT NULL DEFAULT 0,
        labels_json TEXT NOT NULL DEFAULT '[]',
        application_id INTEGER,
        match_confidence REAL NOT NULL DEFAULT 0,
        classification TEXT NOT NULL DEFAULT 'OTHER',
        classification_confidence REAL NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        suggested_outcome TEXT,
        action_status TEXT NOT NULL DEFAULT 'INFO',
        confirmed_at TEXT,
        ignored_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gmail_messages_received
        ON gmail_messages(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gmail_messages_application
        ON gmail_messages(application_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gmail_messages_action
        ON gmail_messages(action_status, received_at DESC);

      CREATE TABLE IF NOT EXISTS gmail_seen_messages (
        gmail_id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_gmail_seen_messages_seen
        ON gmail_seen_messages(seen_at DESC);

      CREATE TABLE IF NOT EXISTS gmail_sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'RUNNING',
        messages_seen INTEGER NOT NULL DEFAULT 0,
        relevant_messages INTEGER NOT NULL DEFAULT 0,
        new_messages INTEGER NOT NULL DEFAULT 0,
        matched_messages INTEGER NOT NULL DEFAULT 0,
        ai_classified INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_gmail_sync_runs_started
        ON gmail_sync_runs(started_at DESC);
    `);

    db.prepare(`
      INSERT OR REPLACE INTO schema_migrations (version, description, applied_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(M10_SCHEMA_VERSION, "M10 Gmail intelligence: OAuth, relevant-mail sync, classification and application matching");
  });
  migrate();
  db.pragma(`user_version = ${M10_SCHEMA_VERSION}`);
  try {
    db.prepare(`INSERT INTO maintenance_events (kind, status, message, details_json) VALUES ('migration', 'PASS', ?, ?)` )
      .run(`Schema upgraded to version ${M10_SCHEMA_VERSION}.`, JSON.stringify({ snapshot }));
  } catch {
    // Migration itself already succeeded; diagnostics are best-effort.
  }
}

function recoverInterruptedWork() {
  const queueRows = db.prepare("SELECT id FROM application_prep_queue WHERE status = 'GENERATING'").all() as Array<{ id: number }>;
  const briefRows = db.prepare("SELECT id FROM daily_discovery_briefs WHERE status = 'RUNNING'").all() as Array<{ id: number }>;
  const browserRows = db.prepare("SELECT id, state FROM applications WHERE state IN ('FILLING', 'SUBMITTING')").all() as Array<{ id: number; state: string }>;
  const tailoringRows = db.prepare(`
    SELECT a.id, a.job_id AS jobId
    FROM applications a
    WHERE a.state = 'TAILORING'
      AND NOT EXISTS (
        SELECT 1 FROM application_prep_queue q
        WHERE q.job_id = a.job_id AND q.status IN ('QUEUED', 'GENERATING')
      )
  `).all() as Array<{ id: number; jobId: number }>;

  const recover = db.transaction(() => {
    db.exec(`
      UPDATE application_prep_queue
      SET status = 'QUEUED',
          error_message = COALESCE(error_message, 'Generation was interrupted by a previous ApplyLite shutdown and was re-queued.'),
          started_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'GENERATING';

      UPDATE daily_discovery_briefs
      SET status = 'INTERRUPTED',
          error_message = COALESCE(error_message, 'Interrupted by a previous ApplyLite shutdown.'),
          completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
      WHERE status = 'RUNNING';
    `);

    for (const row of browserRows) {
      db.prepare("UPDATE applications SET state = 'REVIEW_REQUIRED', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run("The employer browser session ended when ApplyLite stopped. Review the package and reopen the application.", row.id);
      db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, ?, 'REVIEW_REQUIRED', ?)")
        .run(row.id, row.state, "M9 recovery: interrupted browser workflow returned to review.");
    }

    for (const row of tailoringRows) {
      db.prepare("UPDATE applications SET state = 'FAILED', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run("Application package generation was interrupted. Retry generation from the Review Queue or job details.", row.id);
      db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, 'TAILORING', 'FAILED', ?)")
        .run(row.id, "M9 recovery: interrupted package generation requires retry.");
    }
  });
  recover();

  const total = queueRows.length + briefRows.length + browserRows.length + tailoringRows.length;
  if (total > 0) {
    try {
      db.prepare("INSERT INTO maintenance_events (kind, status, message, details_json) VALUES ('recovery', 'PASS', ?, ?)")
        .run(`Recovered ${total} interrupted work item(s) after restart.`, JSON.stringify({
          prepRequeued: queueRows.length,
          briefsInterrupted: briefRows.length,
          browserSessionsReset: browserRows.length,
          tailoringMarkedFailed: tailoringRows.length
        }));
    } catch {
      // Recovery succeeded even if the audit event cannot be stored.
    }
  }
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS answer_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      salary_text TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      score_json TEXT NOT NULL DEFAULT '{}',
      analysis_json TEXT NOT NULL DEFAULT '{}',
      source_text TEXT NOT NULL DEFAULT '',
      ats TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'SCORED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'DISCOVERED',
      ats TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generated_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      package_id INTEGER,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS application_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'REVIEW',
      payload_json TEXT NOT NULL DEFAULT '{}',
      audit_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cv_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discovery_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ats TEXT NOT NULL,
      board_key TEXT NOT NULL,
      name TEXT NOT NULL,
      board_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      learned INTEGER NOT NULL DEFAULT 1,
      last_scan_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ats, board_key)
    );


    CREATE TABLE IF NOT EXISTS discovery_analysis_cache (
      canonical_url TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      source_url TEXT NOT NULL,
      ats TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      sources_scanned INTEGER NOT NULL DEFAULT 0,
      jobs_seen INTEGER NOT NULL DEFAULT 0,
      jobs_shortlisted INTEGER NOT NULL DEFAULT 0,
      jobs_analyzed INTEGER NOT NULL DEFAULT 0,
      jobs_imported INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS field_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ats TEXT NOT NULL DEFAULT 'generic',
      fingerprint TEXT NOT NULL,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0,
      seen_count INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'semantic',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ats, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS skill_learning_plans (
      skill TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'learn',
      status TEXT NOT NULL DEFAULT 'suggested',
      plan_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS application_tracker_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_application_tracker_events_application
      ON application_tracker_events(application_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_discovery_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      run_time TEXT NOT NULL DEFAULT '08:00',
      target_titles_json TEXT NOT NULL DEFAULT '[]',
      locations_json TEXT NOT NULL DEFAULT '[]',
      min_pre_score INTEGER NOT NULL DEFAULT 25,
      min_final_score INTEGER NOT NULL DEFAULT 60,
      max_deep_analysis INTEGER NOT NULL DEFAULT 6,
      analysis_concurrency INTEGER NOT NULL DEFAULT 2,
      shortlist_size INTEGER NOT NULL DEFAULT 5,
      use_outcome_learning INTEGER NOT NULL DEFAULT 1,
      last_run_date TEXT,
      last_started_at TEXT,
      last_completed_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO daily_discovery_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS daily_discovery_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'scheduled',
      status TEXT NOT NULL DEFAULT 'RUNNING',
      discovery_run_id INTEGER,
      jobs_seen INTEGER NOT NULL DEFAULT 0,
      jobs_analyzed INTEGER NOT NULL DEFAULT 0,
      jobs_imported INTEGER NOT NULL DEFAULT 0,
      shortlist_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      settings_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_discovery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW',
      score_snapshot REAL NOT NULL DEFAULT 0,
      base_score_snapshot REAL NOT NULL DEFAULT 0,
      outcome_adjustment REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      FOREIGN KEY(brief_id) REFERENCES daily_discovery_briefs(id) ON DELETE CASCADE,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      UNIQUE(brief_id, job_id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_discovery_briefs_created
      ON daily_discovery_briefs(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_daily_discovery_items_brief
      ON daily_discovery_items(brief_id, rank ASC);

    CREATE INDEX IF NOT EXISTS idx_daily_discovery_items_job
      ON daily_discovery_items(job_id);

    CREATE TABLE IF NOT EXISTS application_prep_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      max_packages_per_brief INTEGER NOT NULL DEFAULT 2,
      min_score REAL NOT NULL DEFAULT 75,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO application_prep_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS application_prep_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      brief_id INTEGER,
      brief_item_id INTEGER,
      source TEXT NOT NULL DEFAULT 'daily',
      status TEXT NOT NULL DEFAULT 'QUEUED',
      score_snapshot REAL NOT NULL DEFAULT 0,
      application_id INTEGER,
      package_id INTEGER,
      audit_status TEXT,
      error_message TEXT,
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY(brief_id) REFERENCES daily_discovery_briefs(id) ON DELETE SET NULL,
      FOREIGN KEY(brief_item_id) REFERENCES daily_discovery_items(id) ON DELETE SET NULL,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE SET NULL,
      FOREIGN KEY(package_id) REFERENCES application_packages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_application_prep_queue_status
      ON application_prep_queue(status, queued_at ASC);

    CREATE INDEX IF NOT EXISTS idx_application_prep_queue_updated
      ON application_prep_queue(updated_at DESC);

  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS interview_packs (
      application_id INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mock_interview_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      feedback_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mock_interview_turns_application
      ON mock_interview_turns(application_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS followup_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE,
      UNIQUE(application_id, kind)
    );
  `);

  ensureJobColumns();
  ensureGeneratedArtifactColumns();
  ensureDiscoveryRunColumns();
  ensureApplicationTrackerColumns();
  runM9Migration();
  runM10Migration();
  migrateWorkflow(db, dbPath);
  recoverInterruptedWork();
}
