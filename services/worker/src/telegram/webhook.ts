import type { Env } from "../index";

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

export async function handleTelegram(request: Request, env: Env): Promise<Response> {
  // Verify the webhook path contains the bot token as a secret
  const url = new URL(request.url);
  const token = url.pathname.replace("/telegram/", "");
  if (token !== env.TELEGRAM_BOT_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") return new Response("OK", { status: 200 });

  const update = (await request.json()) as TelegramUpdate;
  const cb = update.callback_query;
  if (!cb?.data) return new Response("OK");

  const [action, linkId] = cb.data.split(":");
  if (!linkId || (action !== "approve" && action !== "reject")) {
    return new Response("OK");
  }

  const status = action === "approve" ? "approved" : "rejected";
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;

  // Update link status
  await fetch(`${base}/rest/v1/links?id=eq.${linkId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });

  // If approved obvious link, increment trust counter
  if (status === "approved") {
    const linkRes = await fetch(`${base}/rest/v1/links?id=eq.${linkId}&select=confidence`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const links = (await linkRes.json()) as { confidence: number }[];
    if (links[0]?.confidence >= 0.85) {
      await fetch(`${base}/rest/v1/rpc/increment_trust`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
    }
  }

  // Acknowledge button press
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: cb.id,
      text: status === "approved" ? "✅ Link approved!" : "❌ Link rejected.",
    }),
  });

  // Edit original message to remove buttons
  if (cb.message) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  }

  return new Response("OK");
}
