# M10.2 discovery regression initialization fix

This patch changes only `apps/api/scripts/discoveryRegression.ts`.

The regression now calls `initializeDatabase()` before bootstrapping discovery sources, matching the real ApplyLite server startup order. It retains the Windows-safe SQLite close/checkpoint cleanup from the previous patch.
