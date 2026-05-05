import type { Env } from "../app";

export interface Db {
  query(table: string, params?: Record<string, string>): Promise<unknown>;
  insert(table: string, row: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown>;
  upsert(table: string, row: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown>;
  patch(table: string, id: string, patch: Record<string, unknown>): Promise<unknown>;
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

export function db(env: Env): Db {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  return {
    async query(table, params = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async insert(table, row) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async upsert(table, row) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async patch(table, id, patch) {
      const res = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async rpc(fn, args) {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}
