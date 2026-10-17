import { Hono } from "hono";
import { requireIdentity } from "../auth/auth";
import { readBoundedBody } from "./storage";
import { maintainFiles } from "../maintenance";
import { config } from "../config";
import type { AppEnv } from "../types";

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use("/records/:recordId/files", async (c, next) => {
  await requireIdentity(c);
  await next();
});
fileRoutes.use("/files/:id", async (c, next) => {
  await requireIdentity(c);
  await next();
});
fileRoutes.post("/records/:recordId/files", async (c) => {
  const owner = c.get("identity").userId;
  const recordId = c.req.param("recordId");
  const record = await c.env.DB.prepare(
    "SELECT id FROM records WHERE id=? AND owner_id=?",
  )
    .bind(recordId, owner)
    .first();
  if (!record) return c.json({ error: "Record not found" }, 404);
  let name: string;
  try {
    name = decodeURIComponent(c.req.header("X-File-Name") || "attachment")
      .replace(/[\x00-\x1f\x7f/\\]/g, "_")
      .slice(0, 200);
  } catch {
    return c.json({ error: "Invalid file name" }, 400);
  }
  const type = (c.req.header("Content-Type") || "application/octet-stream")
    .split(";")[0]
    .slice(0, 128);
  const id = crypto.randomUUID();
  const key = `${owner}/${id}`;
  await c.env.DB.prepare(
    "INSERT INTO files(id,owner_id,record_id,object_key,name,content_type,size,state,created_at) VALUES(?,?,?,?,?,?,0,'pending',?)",
  )
    .bind(id, owner, recordId, key, name, type, Date.now())
    .run();
  try {
    const bytes = await readBoundedBody(c.req.raw, config.maxFileBytes);
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE files SET upload_complete=1,size=? WHERE id=?",
      ).bind(bytes.byteLength, id),
      c.env.DB.prepare(
        "UPDATE files SET state='ready' WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=?)",
      ).bind(id, recordId, owner),
    ]);
    if (!result[1].meta.changes)
      throw new Error("Record removed during upload");
    return c.json({ id, name, size: bytes.byteLength, contentType: type }, 201);
  } catch (error) {
    await c.env.DB.prepare(
      "UPDATE files SET state='deleting',upload_complete=1,cleanup_at=0 WHERE id=?",
    )
      .bind(id)
      .run();
    await maintainFiles(c.env);
    throw error;
  }
});
fileRoutes.get("/files/:id", async (c) => {
  const file = await c.env.DB.prepare(
    "SELECT object_key,name,content_type FROM files WHERE id=? AND owner_id=? AND state='ready'",
  )
    .bind(c.req.param("id"), c.get("identity").userId)
    .first<{ object_key: string; name: string; content_type: string }>();
  if (!file) return c.json({ error: "File not found" }, 404);
  const object = await c.env.FILES.get(file.object_key);
  if (!object) return c.json({ error: "File not found" }, 404);
  c.header("Content-Type", file.content_type);
  c.header("Content-Length", String(object.size));
  c.header(
    "Content-Disposition",
    `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", "%27")}`,
  );
  return c.body(object.body);
});
fileRoutes.delete("/files/:id", async (c) => {
  const file = await c.env.DB.prepare("SELECT owner_id FROM files WHERE id=?")
    .bind(c.req.param("id"))
    .first<{ owner_id: string }>();
  if (!file) return c.body(null, 204);
  if (file.owner_id !== c.get("identity").userId)
    return c.json({ error: "File not found" }, 404);
  await c.env.DB.prepare(
    "UPDATE files SET state='deleting',cleanup_at=0 WHERE id=? AND owner_id=?",
  )
    .bind(c.req.param("id"), c.get("identity").userId)
    .run();
  await maintainFiles(c.env);
  return c.body(null, 204);
});
