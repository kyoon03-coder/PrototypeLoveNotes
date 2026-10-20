// Backend for the Prototype site. Stores couples, note info and audio in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const okId = (s) => typeof s === "string" && /^[a-z0-9_-]{1,40}$/i.test(s);

export default async (req) => {
  const url = new URL(req.url);
  const [kind, code, id] = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const couples = getStore("couples");
  const meta = getStore("note-meta");
  const audio = getStore("note-audio");

  try {
    // Create a couple space
    if (kind === "couple" && req.method === "POST" && !code) {
      const { a, b } = await req.json();
      if (!a || !b) return json({ error: "Both names are required" }, 400);
      const c = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      await couples.setJSON(c, { a: String(a).slice(0, 24), b: String(b).slice(0, 24), created: Date.now() });
      return json({ code: c });
    }

    if (!okId(code)) return json({ error: "Bad link" }, 400);

    // Read a couple space
    if (kind === "couple" && req.method === "GET") {
      const c = await couples.get(code, { type: "json" });
      return c ? json(c) : json({ error: "Not found" }, 404);
    }

    // List notes for a couple (no audio)
    if (kind === "notes" && req.method === "GET" && !id) {
      const { blobs } = await meta.list({ prefix: code + "/" });
      const items = await Promise.all(blobs.map((b) => meta.get(b.key, { type: "json" })));
      return json(items.filter(Boolean));
    }

    if (!okId(id)) return json({ error: "Bad note id" }, 400);
    const key = `${code}/${id}`;

    // Upload a note: id is "<YYYY-MM-DD>_<a|b>", body is the audio file
    if (kind === "notes" && req.method === "PUT") {
      if (!(await couples.get(code))) return json({ error: "Not found" }, 404);
      const [day, from] = id.split("_");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !["a", "b"].includes(from)) return json({ error: "Bad note id" }, 400);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return json({ error: "Empty recording" }, 400);
      if (buf.byteLength > 5_000_000) return json({ error: "Recording is too long" }, 413);
      const mime = (req.headers.get("content-type") || "audio/webm").split(";")[0];
      const title = decodeURIComponent(req.headers.get("x-title") || "").slice(0, 60);
      await audio.set(key, buf, { metadata: { mime } });
      const m = { id, day, from, title, mime, heard: false, sent: Date.now() };
      await meta.setJSON(key, m);
      return json(m);
    }

    // Download a note's audio
    if (kind === "audio" && req.method === "GET") {
      const r = await audio.getWithMetadata(key, { type: "arrayBuffer" });
      if (!r) return json({ error: "Not found" }, 404);
      return new Response(r.data, {
        headers: { "content-type": r.metadata?.mime || "audio/webm", "cache-control": "no-store" },
      });
    }

    // Mark a note as heard
    if (kind === "heard" && req.method === "POST") {
      const m = await meta.get(key, { type: "json" });
      if (!m) return json({ error: "Not found" }, 404);
      m.heard = true;
      await meta.setJSON(key, m);
      return json(m);
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: "/api/*" };
