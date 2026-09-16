# ApplyLite M9 typecheck fix

This patch fixes two React/TypeScript errors in `apps/web/src/pages/SystemPage.tsx`.

The diagnostics payload uses `Record<string, unknown>`, so `row.errorMessage && ...` and `row.lastError && ...` could evaluate to `unknown`, which is not a valid ReactNode. Both conditions are now normalized with `Boolean(...)` before rendering.

No runtime behavior, database schema, API routes, or M9 data is changed.
