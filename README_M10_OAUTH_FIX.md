# ApplyLite M10 Gmail OAuth removal hotfix

Fixes HTTP 400 when clicking **Remove OAuth config**.

Cause: the shared frontend API helper added `Content-Type: application/json` even to requests with no body. Fastify rejects an empty body declared as JSON before the DELETE route can run.

Patch:
- `apps/web/src/lib/api.ts`
- only sets JSON content type when a request body actually exists.

After applying:
1. run `npm run typecheck`
2. run `npm run dev`
3. open Gmail Intelligence
4. click **Remove OAuth config**
5. select the replacement Desktop OAuth JSON
6. click **Connect Gmail**
