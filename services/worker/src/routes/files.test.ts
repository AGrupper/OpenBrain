import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { strToU8, zlibSync } from "fflate";
import {
  handleFiles,
  readUploadHeaders,
  parseFilesQuery,
  isValidEmbedding,
  EMBEDDING_DIMENSIONS,
  folderFromPath,
} from "./files";
import type { Env } from "../app";

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    VAULT_BUCKET: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    } as unknown as R2Bucket,
    ...overrides,
  };
}

describe("readUploadHeaders", () => {
  it("returns parsed metadata when all headers are present", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "notes/a.md",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": "42",
        "Content-Type": "text/markdown",
      },
    });
    expect(readUploadHeaders(req)).toEqual({
      path: "notes/a.md",
      sha256: "deadbeef",
      size: 42,
      mime: "text/markdown",
    });
  });

  it("defaults Content-Type to octet-stream when missing", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "blob.bin",
        "X-File-Sha256": "abc",
        "X-File-Size": "1",
      },
    });
    expect(readUploadHeaders(req)?.mime).toBe("application/octet-stream");
  });

  it("returns null when a required header is missing", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: { "X-File-Path": "a.md", "X-File-Sha256": "abc" },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });

  it("returns null when X-File-Size is non-numeric", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "not-a-number",
      },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });

  it("returns null when X-File-Size is negative", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "-1",
      },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });
});

describe("folderFromPath", () => {
  it("returns null for root files", () => {
    expect(folderFromPath("note.md")).toBeNull();
  });

  it("returns the parent folder for nested files", () => {
    expect(folderFromPath("Projects/OpenBrain/prd.md")).toBe("Projects/OpenBrain");
  });
});

describe("handleFiles — PUT /files/upload", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ id: "file-1", path: "n.md" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects when X-File-* headers are absent", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      body: "hello",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("rejects when body length disagrees with X-File-Size", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "999",
        "Content-Type": "text/markdown",
      },
      body: "hi",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("stores blob in R2 and upserts metadata when headers + body match", async () => {
    const env = makeEnv();
    const body = "hello world"; // 11 bytes
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "n.md",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": String(body.length),
        "Content-Type": "text/markdown",
      },
      body,
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "n.md",
      expect.any(ArrayBuffer),
      expect.objectContaining({ sha256: "deadbeef" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      text_content: body,
      needs_wiki: true,
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("derives folder and stores searchable text content for text uploads", async () => {
    const env = makeEnv();
    const body = "# Project note";
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "Projects/OpenBrain/note.md",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": String(body.length),
        "Content-Type": "text/markdown",
      },
      body,
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([
      expect.objectContaining({ path: "Projects", parent_path: null }),
      expect.objectContaining({ path: "Projects/OpenBrain", parent_path: "Projects" }),
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      folder: "Projects/OpenBrain",
      text_content: body,
      needs_wiki: true,
    });
  });

  it("does not mark wiki pending when upload has no extracted text", async () => {
    const env = makeEnv();
    const body = "binary-ish";
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "archive.bin",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": String(body.length),
        "Content-Type": "application/octet-stream",
      },
      body,
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      path: "archive.bin",
      text_content: null,
      needs_wiki: false,
    });
  });
});

describe("handleFiles — POST /files/text", () => {
  it("creates a markdown file in R2 and stores its metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ path: "Projects" }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "file-1",
              path: "Projects/OpenBrain/notes.md",
              size: 7,
              sha256: "hash",
              mime: "text/markdown",
              folder: "Projects/OpenBrain",
              updated_at: "now",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects/OpenBrain/notes.md", content: "# Hello" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "Projects/OpenBrain/notes.md",
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "text/markdown" },
        sha256: expect.any(String),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual([
      expect.objectContaining({ path: "Projects", parent_path: null }),
      expect.objectContaining({ path: "Projects/OpenBrain", parent_path: "Projects" }),
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      path: "Projects/OpenBrain/notes.md",
      folder: "Projects/OpenBrain",
      text_content: "# Hello",
      needs_embedding: true,
      needs_linking: true,
      needs_tagging: true,
      needs_wiki: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({
      file_id: "file-1",
      status: "pending",
    });
  });

  it("does not mark wiki pending for an empty markdown file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "file-1",
              path: "empty.md",
              size: 0,
              sha256: "hash",
              mime: "text/markdown",
              updated_at: "now",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "empty.md", content: "" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      path: "empty.md",
      text_content: "",
      needs_embedding: true,
      needs_linking: true,
      needs_tagging: true,
      needs_wiki: false,
    });
  });

  it("rejects non-markdown file paths", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects/OpenBrain/notes.txt", content: "Hello" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(400);
    expect(env.VAULT_BUCKET.put).not.toHaveBeenCalled();
  });

  it("rejects duplicate file paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: "existing-file" }]), { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects/OpenBrain/notes.md", content: "Hello" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(409);
    expect(env.VAULT_BUCKET.put).not.toHaveBeenCalled();
  });
});

describe("handleFiles - POST /files/url", () => {
  function responseWithUrl(body: BodyInit | null, url: string, init?: ResponseInit): Response {
    const res = new Response(body, init);
    Object.defineProperty(res, "url", { value: url });
    return res;
  }

  function makeSimplePdf(text: string): string {
    const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
    return makePdfWithStream(stream, "");
  }

  function makeCompressedPdf(text: string): Uint8Array {
    const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
    const compressed = zlibSync(strToU8(stream));
    return concatBytes(
      strToU8(
        `%PDF-1.1\n1 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
      ),
      compressed,
      strToU8("\nendstream\nendobj\n%%EOF"),
    );
  }

  function makePdfWithStream(stream: string, streamOptions: string): string {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< ${streamOptions}/Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.1\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return pdf;
  }

  function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function makeUrlFetchMock(options: {
    existingSourceUrl?: boolean;
    folders?: { path: string }[];
    external?: (url: string) => Response | Promise<Response>;
  }) {
    const folders = options.folders ?? [{ path: "Resources/Web" }];
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const calledUrl = String(input);
      if (!calledUrl.startsWith("https://stub.supabase.co")) {
        if (!options.external) return new Response("not mocked", { status: 404 });
        return options.external(calledUrl);
      }

      if (calledUrl.includes("/rest/v1/files?source_url=")) {
        return new Response(
          JSON.stringify(options.existingSourceUrl ? [{ id: "existing", path: "old.md" }] : []),
          { status: 200 },
        );
      }
      if (calledUrl.includes("/rest/v1/folders?")) {
        return new Response(JSON.stringify(folders), { status: 200 });
      }
      if (calledUrl.includes("/rest/v1/files?path=")) {
        return new Response("[]", { status: 200 });
      }
      if (calledUrl.endsWith("/rest/v1/folders")) {
        return new Response(init?.body ?? "[]", { status: 200 });
      }
      if (calledUrl.endsWith("/rest/v1/files")) {
        const row = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify([{ id: "url-file-1", ...row }]), { status: 200 });
      }
      if (calledUrl.endsWith("/rest/v1/architect_jobs")) {
        return new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
  }

  it("rejects private network URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1/admin" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports a webpage as extracted text and chooses a matching existing folder", async () => {
    const fetchMock = makeUrlFetchMock({
      folders: [{ path: "Resources/Web" }, { path: "Projects/OpenBrain" }],
      external: (calledUrl) => {
        if (calledUrl !== "https://openbrain.dev/articles/project-intel") {
          return new Response("not found", { status: 404 });
        }
        return responseWithUrl(
          "<html><head><title>OpenBrain Project Notes</title></head><body><article><p>Useful project intelligence.</p></article></body></html>",
          calledUrl,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://openbrain.dev/articles/project-intel" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "Projects/OpenBrain/OpenBrain Project Notes.md",
      expect.any(Uint8Array),
      expect.objectContaining({ httpMetadata: { contentType: "text/markdown" } }),
    );
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Projects/OpenBrain/OpenBrain Project Notes.md",
      folder: "Projects/OpenBrain",
      source_type: "webpage",
      source_url: "https://openbrain.dev/articles/project-intel",
      extraction_status: "extracted",
      needs_wiki: true,
    });
  });

  it("does not use URL query parameters for folder matching", async () => {
    const fetchMock = makeUrlFetchMock({
      folders: [{ path: "Resources/Web" }, { path: "smoke" }],
      external: (calledUrl) =>
        responseWithUrl(
          "<html><head><title>Example Domain</title></head><body><p>Readable page text.</p></body></html>",
          calledUrl,
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/?openbrain_smoke=1" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/Example Domain.md",
      folder: "Resources/Web",
      extraction_status: "extracted",
      needs_wiki: true,
    });
  });

  it("imports a URL into an explicitly requested folder", async () => {
    const fetchMock = makeUrlFetchMock({
      folders: [{ path: "Resources/Web" }, { path: "Projects/OpenBrain" }],
      external: (calledUrl) =>
        responseWithUrl("<title>Roadmap</title><p>Project URL import.</p>", calledUrl, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/roadmap",
        folder: "Projects/OpenBrain",
      }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Projects/OpenBrain/Roadmap.md",
      folder: "Projects/OpenBrain",
      source_type: "webpage",
      extraction_status: "extracted",
      needs_wiki: true,
    });
  });

  it("imports a YouTube URL without marking wiki work as pending", async () => {
    const fetchMock = makeUrlFetchMock({
      external: (calledUrl) => {
        if (calledUrl.startsWith("https://www.youtube.com/oembed?")) {
          return new Response(JSON.stringify({ title: "Demo Video", author_name: "OpenBrain" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (calledUrl.startsWith("https://video.google.com/timedtext?")) {
          return new Response(calledUrl.includes("type=list") ? "<transcript_list />" : "", {
            status: 200,
            headers: { "Content-Type": "application/xml" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc123" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/Demo Video - OpenBrain.md",
      source_type: "youtube",
      source_url: "https://www.youtube.com/watch?v=abc123",
      extraction_status: "no_text",
      needs_wiki: false,
    });
  });

  it("imports public YouTube transcripts when captions are available", async () => {
    const fetchMock = makeUrlFetchMock({
      external: (calledUrl) => {
        if (calledUrl.startsWith("https://www.youtube.com/oembed?")) {
          return new Response(JSON.stringify({ title: "Captioned Video" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (calledUrl.includes("type=list")) {
          return new Response(
            '<transcript_list><track lang_code="en" name="" /></transcript_list>',
            {
              status: 200,
              headers: { "Content-Type": "application/xml" },
            },
          );
        }
        if (calledUrl.startsWith("https://video.google.com/timedtext?")) {
          return new Response(
            '<transcript><text start="0" dur="1">Hello &amp; welcome.</text><text start="1" dur="1">Second caption line.</text></transcript>',
            { status: 200, headers: { "Content-Type": "application/xml" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://youtu.be/captioned123" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/Captioned Video.md",
      source_type: "youtube",
      source_url: "https://youtu.be/captioned123",
      extraction_status: "extracted",
      needs_wiki: true,
      text_content: expect.stringContaining("Hello & welcome."),
    });
  });

  it("imports a PDF URL as a preserved source note without extracted text", async () => {
    const fetchMock = makeUrlFetchMock({
      external: (calledUrl) =>
        responseWithUrl("%PDF-1.7", calledUrl, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/report.pdf" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/report.md",
      source_type: "pdf",
      source_url: "https://example.com/report.pdf",
      extraction_status: "no_text",
      needs_wiki: false,
    });
  });

  it("imports extracted PDF text when readable text is available", async () => {
    const fetchMock = makeUrlFetchMock({
      external: (calledUrl) =>
        responseWithUrl(makeSimplePdf("Hello PDF smoke"), calledUrl, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/readable.pdf" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/readable.md",
      source_type: "pdf",
      source_url: "https://example.com/readable.pdf",
      extraction_status: "extracted",
      needs_wiki: true,
      text_content: expect.stringContaining("Hello PDF smoke"),
    });
  });

  it("imports extracted PDF text from Flate-compressed streams", async () => {
    const fetchMock = makeUrlFetchMock({
      external: (calledUrl) =>
        responseWithUrl(makeCompressedPdf("Compressed PDF smoke"), calledUrl, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/compressed.pdf" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    const filesUpsert = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/rest/v1/files"),
    );
    expect(JSON.parse(String(filesUpsert?.[1]?.body))).toMatchObject({
      path: "Resources/Web/compressed.md",
      source_type: "pdf",
      source_url: "https://example.com/compressed.pdf",
      extraction_status: "extracted",
      needs_wiki: true,
      text_content: expect.stringContaining("Compressed PDF smoke"),
    });
  });

  it("rejects an already imported URL before fetching the remote source", async () => {
    const fetchMock = makeUrlFetchMock({
      existingSourceUrl: true,
      external: () => new Response("should not fetch", { status: 500 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/dupe" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(409);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]) === "https://example.com/dupe"),
    ).toBe(false);
  });
});

describe("parseFilesQuery", () => {
  it("defaults to select=* and order=updated_at.desc with no params", () => {
    const { params, error } = parseFilesQuery(new URLSearchParams());
    expect(error).toBeUndefined();
    expect(params).toEqual({ deleted_at: "is.null", order: "updated_at.desc", select: "*" });
  });

  it("translates needs_linking/needs_tagging/needs_embedding=true to eq.true", () => {
    const sp = new URLSearchParams(
      "needs_linking=true&needs_tagging=true&needs_embedding=true&needs_wiki=true",
    );
    const { params } = parseFilesQuery(sp);
    expect(params.needs_linking).toBe("eq.true");
    expect(params.needs_tagging).toBe("eq.true");
    expect(params.needs_embedding).toBe("eq.true");
    expect(params.needs_wiki).toBe("eq.true");
  });

  it("ignores boolean filters when value is not 'true'", () => {
    const { params } = parseFilesQuery(new URLSearchParams("needs_linking=false"));
    expect(params.needs_linking).toBeUndefined();
  });

  it("clamps limit to FILES_MAX_LIMIT (500)", () => {
    const { params } = parseFilesQuery(new URLSearchParams("limit=9999"));
    expect(params.limit).toBe("500");
  });

  it("rejects non-positive limit", () => {
    const { error } = parseFilesQuery(new URLSearchParams("limit=0"));
    expect(error).toMatch(/limit/);
  });

  it("rejects non-numeric limit", () => {
    const { error } = parseFilesQuery(new URLSearchParams("limit=abc"));
    expect(error).toMatch(/limit/);
  });

  it("accepts whitelisted select columns", () => {
    const { params, error } = parseFilesQuery(new URLSearchParams("select=folder,tags"));
    expect(error).toBeUndefined();
    expect(params.select).toBe("folder,tags");
  });

  it("rejects unknown select columns", () => {
    const { error } = parseFilesQuery(new URLSearchParams("select=folder,evil_column"));
    expect(error).toMatch(/Unknown select/);
  });
});

describe("isValidEmbedding", () => {
  it("accepts an array of 1024 finite numbers", () => {
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    expect(isValidEmbedding(v)).toBe(true);
  });

  it("rejects wrong-length arrays", () => {
    expect(isValidEmbedding(new Array(1536).fill(0.1))).toBe(false);
    expect(isValidEmbedding([])).toBe(false);
  });

  it("rejects arrays with non-numeric or non-finite entries", () => {
    const bad = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    bad[0] = "x";
    expect(isValidEmbedding(bad)).toBe(false);
    bad[0] = Number.NaN;
    expect(isValidEmbedding(bad)).toBe(false);
    bad[0] = Number.POSITIVE_INFINITY;
    expect(isValidEmbedding(bad)).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidEmbedding(null)).toBe(false);
    expect(isValidEmbedding({})).toBe(false);
    expect(isValidEmbedding("abc")).toBe(false);
  });
});

describe("handleFiles — GET /files filters", () => {
  it("rejects unknown select columns with 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?select=evil");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("forwards needs_tagging=true and limit to Supabase URL", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?needs_tagging=true&limit=50");
    await handleFiles(req, env, new URL(req.url));
    const calls = fetchMock.mock.calls as unknown[][];
    const calledUrl = String(calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("needs_tagging=eq.true");
    expect(calledUrl).toContain("limit=50");
  });
});

describe("handleFiles — POST /files/:id/embedding", () => {
  it("rejects wrong-dimension embedding payloads with 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedding: new Array(1536).fill(0.1), text_preview: "x" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("accepts a valid 1024-dim embedding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.1),
        text_preview: "x",
      }),
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(204);
  });
});

describe("handleFiles — PATCH /files/:id with path change", () => {
  it("copies R2 object and deletes old key when path changes", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: db.query for current path
      .mockResolvedValueOnce(new Response(JSON.stringify([{ path: "old/n.md" }]), { status: 200 }))
      // 2nd call: ensure destination parent folder exists
      .mockResolvedValueOnce(new Response(JSON.stringify([{ path: "new" }]), { status: 200 }))
      // 3rd call: db.patch result
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "abc", path: "new/n.md" }]), { status: 200 }),
      )
      // 4th call: architect job after actual path change
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r2Body = new ArrayBuffer(4);
    const env = makeEnv({
      VAULT_BUCKET: {
        put: vi.fn(async () => undefined),
        get: vi.fn(async () => ({ body: r2Body, httpMetadata: { contentType: "text/markdown" } })),
        delete: vi.fn(async () => undefined),
      } as unknown as R2Bucket,
    });
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new/n.md" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(env.VAULT_BUCKET.get).toHaveBeenCalledWith("old/n.md");
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "new/n.md",
      r2Body,
      expect.objectContaining({ httpMetadata: { contentType: "text/markdown" } }),
    );
    expect(env.VAULT_BUCKET.delete).toHaveBeenCalledWith("old/n.md");
  });

  it("does not touch R2 when path is unchanged", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ path: "n.md" }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "abc", path: "n.md" }]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "n.md" }),
    });
    await handleFiles(req, env, new URL(req.url));
    expect(env.VAULT_BUCKET.get).not.toHaveBeenCalled();
    expect(env.VAULT_BUCKET.put).not.toHaveBeenCalled();
    expect(env.VAULT_BUCKET.delete).not.toHaveBeenCalled();
  });

  it("does not touch R2 when body has no path field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "abc", folder: "Inbox" }]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "Inbox" }),
    });
    await handleFiles(req, env, new URL(req.url));
    expect(env.VAULT_BUCKET.get).not.toHaveBeenCalled();
  });
});

describe("handleFiles — PATCH /files/:id with Markdown text_content", () => {
  it("rewrites the Markdown object and marks the file for reprocessing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ path: "Resources/notes.md" }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "abc", path: "Resources/notes.md", text_content: "# Updated" }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_content: "# Updated" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(200);
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "Resources/notes.md",
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "text/markdown" },
        sha256: expect.any(String),
      }),
    );
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patchBody).toMatchObject({
      path: "Resources/notes.md",
      folder: "Resources",
      text_content: "# Updated",
      size: 9,
      sha256: expect.any(String),
      mime: "text/markdown",
      needs_embedding: true,
      needs_linking: true,
      needs_tagging: true,
      needs_wiki: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      file_id: "abc",
      status: "pending",
    });
  });

  it("clears wiki pending for whitespace-only Markdown text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ path: "Resources/notes.md" }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "abc", path: "Resources/notes.md", text_content: "   " }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "job-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_content: "   " }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(200);
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patchBody).toMatchObject({
      text_content: "   ",
      needs_embedding: true,
      needs_linking: true,
      needs_tagging: true,
      needs_wiki: false,
    });
  });

  it("rejects non-string text_content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_content: null }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.VAULT_BUCKET.put).not.toHaveBeenCalled();
  });

  it("rejects text_content updates for non-Markdown files", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ path: "Resources/notes.txt" }]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_content: "Updated" }),
    });

    const res = await handleFiles(req, env, new URL(req.url));

    expect(res.status).toBe(400);
    expect(env.VAULT_BUCKET.put).not.toHaveBeenCalled();
  });
});

describe("handleFiles — DELETE /files?path=", () => {
  it("looks up by path, then soft-deletes the DB row", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: db.query by path
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "row-1", path: "notes/x.md" }]), { status: 200 }),
      )
      // 2nd call: db.patch soft delete
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "row-1", path: "notes/x.md" }]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?path=notes/x.md", {
      method: "DELETE",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(204);
    expect(env.VAULT_BUCKET.delete).not.toHaveBeenCalled();
    const calls = fetchMock.mock.calls as unknown[][];
    const queryUrl = String(calls[0]?.[0] ?? "");
    const patchUrl = String(calls[1]?.[0] ?? "");
    expect(queryUrl).toContain("path=eq.notes%2Fx.md");
    expect(patchUrl).toContain("id=eq.row-1");
    expect(calls[1]?.[1]).toMatchObject({ method: "PATCH" });
  });

  it("returns 204 idempotently when no row matches the path", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?path=missing.md", {
      method: "DELETE",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(204);
    expect(env.VAULT_BUCKET.delete).not.toHaveBeenCalled();
  });

  it("rejects with 400 when path query param is missing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files", { method: "DELETE" });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });
});

describe("handleFiles — GET /files/:id", () => {
  it("returns 404 when supabase returns empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/missing");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(404);
  });

  it("returns the file row when supabase returns a match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: "x",
                path: "n.md",
                size: 1,
                sha256: "a",
                mime: "text/markdown",
                updated_at: "now",
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/x");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "x", path: "n.md" });
  });
});
