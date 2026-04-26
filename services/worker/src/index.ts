import { handleFiles } from "./routes/files";
import { handleLinks } from "./routes/links";
import { handleSearch } from "./routes/search";
import { handleCorrections } from "./routes/corrections";
import { handleTelegram } from "./telegram/webhook";

export interface Env {
  VAULT_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENBRAIN_AUTH_TOKEN: string;
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

    // Telegram webhook — verified by bot token in the path, no auth header needed
    if (path.startsWith("/telegram/")) {
      return handleTelegram(request, env);
    }

    // All other routes require bearer auth
    const authError = auth(request, env);
    if (authError) return authError;

    if (path.startsWith("/files")) return handleFiles(request, env, url);
    if (path.startsWith("/links")) return handleLinks(request, env, url);
    if (path.startsWith("/search")) return handleSearch(request, env, url);
    if (path.startsWith("/corrections")) return handleCorrections(request, env, url);

    return new Response("Not found", { status: 404 });
  },
};
