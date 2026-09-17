# Workflow API and operational notes

## Persistent tasks

- `POST /discovery/runs` returns HTTP 202 and a task object. `id` (and the compatibility `runId` alias in this response) is a task UUID. After execution starts, `counters.runId`/`result.runId` identify the integer `discovery_runs` row.
- `GET /discovery/runs/latest`, `GET /discovery/runs/:id` return task state. `GET /discovery/results?runId=<integer>` filters saved jobs by run membership; omit for all saved discoveries.
- `POST /discovery/jobs/:id/analyze` queues a single-job analysis.
- `POST /cv/drafts/:id/enhance` returns 202 with the saved draft and its task.
- `GET /tasks`, `GET /tasks/:id`, `POST /tasks/:id/cancel`, `POST /tasks/:id/retry` provide observation/control.

Task states: QUEUED, RUNNING, CANCELLING, COMPLETED, FAILED, CANCELLED, INTERRUPTED. A lease and status check fence writes; outbound requests inherit cancellation. Workers never hold a database transaction across network I/O. One task runs at a time, with provider-level request serialization also protecting existing non-task AI features. Inputs are saved privately in SQLite; public task responses exclude source inputs and keys.

Progress counters are factual. UI bars apply to a phase; overall work estimates are not represented as promises. Cancellation preserves already-saved facts and jobs. Retrying discovery uses stable canonical URL identity and does not create duplicate copies of known jobs. CV retries use the current unreviewed revision and cannot overwrite a published review.

## Facts and preferences

`GET /onboarding/status` derives readiness from current saved data. Missing dates/contact details are advisory. `GET /profile/role-suggestions` uses reviewed facts. `POST /profile/role-suggestions/accept` requires a matching CV ID and `confirmed:true`; the UI may alternatively stage choices in the editable Profile form, where Save explicitly confirms them.

Contacts, raw dates and history are facts. Target roles, salary preferences, hiring-country choices and consent are not extracted as facts. Profile merge fills blanks and merges skills without replacing user choices.

## Provider controls

`GET/PUT /ai/settings`, `GET /ai/providers`, `POST /ai/providers/test`. Tests use a fixed synthetic request. Real external providers are not contacted by automated contract tests. Consent is checked immediately before remote calls; already-sent data cannot be withdrawn. Keys remain API-side. Logs expose safe error categories, never model source prompts or credentials.

## Migration, restart and limitations

Schema 11 extends the existing store transactionally after a pre-migration snapshot. Startup marks interrupted active tasks and discovery rows; safe queued work can start. Retry restarts an extraction/run rather than resuming token generation. Page reload is not backend restart. Closing the launcher or sleeping the PC is not a supported way to continue background processing.

The legacy synchronous `/discovery/run` remains for compatibility with earlier clients. Daily discovery and application preparation retain their prior worker APIs. All final employer submissions remain manual. Live provider accuracy, unusual CVs, professional qualifications and hiring eligibility always require review.
