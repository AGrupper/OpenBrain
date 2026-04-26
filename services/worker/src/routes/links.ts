import type { Env } from "../index";
import type { Link } from "@openbrain/shared";

function db(env: Env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    async query(table: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async upsert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async patch(table: string, id: string, patch: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}

export async function handleLinks(request: Request, env: Env, url: URL): Promise<Response> {
  const { method } = request;
  const segments = url.pathname
    .replace(/^\/links/, "")
    .split("/")
    .filter(Boolean);
  const linkId = segments[0];
  const sub = segments[1];

  try {
    // GET /links — list approved links (for graph view)
    if (method === "GET" && !linkId) {
      const status = url.searchParams.get("status") ?? "approved";
      const rows = await db(env).query("links", {
        status: `eq.${status}`,
        select: "*",
        order: "created_at.desc",
      });
      return Response.json(rows);
    }

    // POST /links/proposals — Friday creates a new proposed link
    if (method === "POST" && linkId === "proposals" && !sub) {
      const body = (await request.json()) as {
        file_a_id: string;
        file_b_id: string;
        confidence: number;
        reason: string;
      };

      // Check trust threshold — auto-approve obvious links if trust is established
      const trustRows = (await db(env).query("trust_metrics", {
        id: "eq.1",
        select: "obvious_links_silent",
      })) as { obvious_links_silent: boolean }[];
      const silentMode = trustRows[0]?.obvious_links_silent ?? false;
      const isObvious = body.confidence >= 0.85;

      let status: Link["status"] = "pending";
      if (silentMode && isObvious) {
        status = "auto_approved";
      }

      const rows = (await db(env).upsert("links", {
        file_a_id: body.file_a_id,
        file_b_id: body.file_b_id,
        confidence: body.confidence,
        reason: body.reason,
        status,
        updated_at: new Date().toISOString(),
      })) as Link[];

      const link = rows[0];

      // Send Telegram approval request for non-auto-approved links
      if (link.status === "pending") {
        await sendTelegramApproval(env, link);
      }

      return Response.json(link, { status: 201 });
    }

    // PATCH /links/:id — Friday or Telegram webhook updates status
    if (method === "PATCH" && linkId && !sub) {
      const body = (await request.json()) as {
        status: Link["status"];
        telegram_message_id?: number;
      };
      const rows = await db(env).patch("links", linkId, {
        ...body,
        updated_at: new Date().toISOString(),
      });

      // Update trust metrics if an obvious link was approved
      if (body.status === "approved") {
        const linkRows = (await db(env).query("links", {
          id: `eq.${linkId}`,
          select: "confidence",
        })) as { confidence: number }[];
        if (linkRows[0]?.confidence >= 0.85) {
          await db(env).rpc("increment_trust", {});
        }
      }

      return Response.json(rows);
    }

    // GET /links/for-file/:fileId — all links involving a file (for bottom panel)
    if (method === "GET" && linkId === "for-file" && sub) {
      const rows = await db(env).query("links", {
        or: `(file_a_id.eq.${sub},file_b_id.eq.${sub})`,
        status: "eq.approved",
        select: "*",
      });
      return Response.json(rows);
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

async function sendTelegramApproval(env: Env, link: Link): Promise<void> {
  // Fetch file titles
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;

  const [rowsA, rowsB] = await Promise.all([
    fetch(`${base}/rest/v1/files?id=eq.${link.file_a_id}&select=path`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }).then((r) => r.json()) as Promise<{ path: string }[]>,
    fetch(`${base}/rest/v1/files?id=eq.${link.file_b_id}&select=path`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }).then((r) => r.json()) as Promise<{ path: string }[]>,
  ]);

  const titleA = rowsA[0]?.path.split("/").pop() ?? link.file_a_id;
  const titleB = rowsB[0]?.path.split("/").pop() ?? link.file_b_id;
  const pct = Math.round(link.confidence * 100);

  const text = `🔗 *New connection proposed* (${pct}% confidence)\n\n📄 *${titleA}*\n📄 *${titleB}*\n\n_${link.reason}_`;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${link.id}` },
            { text: "❌ Reject", callback_data: `reject:${link.id}` },
          ],
        ],
      },
    }),
  });
}
