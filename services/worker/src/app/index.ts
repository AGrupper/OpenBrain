import { handleFiles } from "../routes/files";
import { handleLinks } from "../routes/links";
import { handleSearch } from "../routes/search";
import { handleCorrections } from "../routes/corrections";
import { handleArchitect } from "../routes/architect";
import { handleTelegram } from "../telegram/webhook";

export interface Env {
  VAULT_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENBRAIN_AUTH_TOKEN: string;
  OPENAI_API_KEY?: string;
  ARCHITECT_MODEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-File-Path, X-File-Sha256, X-File-Size",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function auth(request: Request, env: Env): Response | null {
  const header = request.headers.get("Authorization") ?? "";
  if (header !== `Bearer ${env.OPENBRAIN_AUTH_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight — answer before auth so the browser can send the actual request
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Telegram webhook — verified by bot token in the path, no auth header needed
    if (path.startsWith("/telegram/")) {
      return handleTelegram(request, env);
    }

    // All other routes require bearer auth
    const authError = auth(request, env);
    if (authError) return withCors(authError);

    let response: Response;
    if (path.startsWith("/files")) response = await handleFiles(request, env, url);
    else if (path.startsWith("/links")) response = await handleLinks(request, env, url);
    else if (path.startsWith("/search")) response = await handleSearch(request, env, url);
    else if (path.startsWith("/corrections")) response = await handleCorrections(request, env, url);
    else if (path.startsWith("/architect")) response = await handleArchitect(request, env, url);
    else response = new Response("Not found", { status: 404 });

    return withCors(response);
  },
};
