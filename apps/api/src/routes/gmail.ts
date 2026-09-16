import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildGmailReplyDraft,
  completeGmailOAuth,
  configureGmailOAuth,
  createGmailAuthorizationUrl,
  disconnectGmail,
  getGmailOverview,
  ignoreGmailMessage,
  confirmGmailMessageAction,
  removeGmailOAuthConfiguration,
  setGmailMessageApplication,
  syncGmail,
  updateGmailSettings
} from "../services/gmail.js";

const ConfigureSchema = z.object({ credentials: z.unknown() });
const SettingsSchema = z.object({
  syncEnabled: z.boolean(),
  intervalMinutes: z.number().int().min(5).max(120),
  lookbackDays: z.number().int().min(1).max(90)
});
const MatchSchema = z.object({ applicationId: z.number().int().positive().nullable() });

export async function gmailRoutes(app: FastifyInstance) {
  app.get("/gmail/overview", async () => getGmailOverview());

  app.post("/gmail/oauth/config", async (request, reply) => {
    try {
      const input = ConfigureSchema.parse(request.body ?? {});
      return configureGmailOAuth(input.credentials);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/gmail/oauth/config", async () => removeGmailOAuthConfiguration());

  app.post("/gmail/oauth/start", async (_request, reply) => {
    try { return createGmailAuthorizationUrl(); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/gmail/oauth/callback", async (request, reply) => {
    if (request.query.error) {
      return reply.type("text/html").send(`<!doctype html><html><body style="font-family:system-ui;padding:40px"><h2>Gmail was not connected</h2><p>${escapeHtml(request.query.error)}</p><p>You can close this tab and return to ApplyLite.</p></body></html>`);
    }
    if (!request.query.code || !request.query.state) {
      return reply.code(400).type("text/html").send("<!doctype html><html><body><h2>Missing OAuth code/state.</h2></body></html>");
    }
    try {
      const result = await completeGmailOAuth(request.query.code, request.query.state);
      return reply.type("text/html").send(`<!doctype html><html><body style="font-family:system-ui;padding:40px;max-width:720px;margin:auto"><h2>Gmail connected</h2><p>ApplyLite now has read-only access to <strong>${escapeHtml(result.email)}</strong>.</p><p>Only career-related messages are retained locally. You can close this tab and return to ApplyLite.</p><script>setTimeout(()=>window.close(),2500)</script></body></html>`);
    } catch (error) {
      return reply.code(422).type("text/html").send(`<!doctype html><html><body style="font-family:system-ui;padding:40px"><h2>Gmail connection failed</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><p>Close this tab and try Connect Gmail again.</p></body></html>`);
    }
  });

  app.post("/gmail/disconnect", async () => disconnectGmail());

  app.put("/gmail/settings", async (request) => {
    const input = SettingsSchema.parse(request.body ?? {});
    return { settings: updateGmailSettings(input) };
  });

  app.post("/gmail/sync", async (_request, reply) => {
    try { return await syncGmail("manual"); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.put<{ Params: { id: string } }>("/gmail/messages/:id/match", async (request, reply) => {
    try {
      const input = MatchSchema.parse(request.body ?? {});
      return setGmailMessageApplication(decodeURIComponent(request.params.id), input.applicationId);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/gmail/messages/:id/confirm", async (request, reply) => {
    try { return confirmGmailMessageAction(decodeURIComponent(request.params.id)); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.post<{ Params: { id: string } }>("/gmail/messages/:id/ignore", async (request, reply) => {
    try { return ignoreGmailMessage(decodeURIComponent(request.params.id)); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.get<{ Params: { id: string } }>("/gmail/messages/:id/reply-draft", async (request, reply) => {
    try { return buildGmailReplyDraft(decodeURIComponent(request.params.id)); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}

function escapeHtml(value: string) {
  const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}
