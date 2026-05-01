import type { Env } from "../app";
import type { Correction } from "@openbrain/shared";

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
    async insert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}

export async function handleCorrections(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (request.method === "GET") {
      const limit = url.searchParams.get("limit") ?? "20";
      const rows = await db(env).query("corrections", {
        select: "*",
        order: "created_at.desc",
        limit,
      });
      return Response.json(rows);
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        file_id: string;
        field: Correction["field"];
        old_value: string;
        new_value: string;
      };
      const rows = (await db(env).insert("corrections", {
        file_id: body.file_id,
        field: body.field,
        old_value: body.old_value,
        new_value: body.new_value,
        created_at: new Date().toISOString(),
      })) as Correction[];
      return Response.json(rows[0], { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
