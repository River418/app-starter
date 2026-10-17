import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, sql, desc, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { recordInput } from "../shared/contracts";
import { records } from "../../../server/db/schema";
import { requireIdentity } from "../../../server/auth/auth";
import { maintainFiles } from "../../../server/maintenance";
import type { AppEnv } from "../../../server/types";

export const recordRoutes = new Hono<AppEnv>();
recordRoutes.use("*", async (c, next) => {
  await requireIdentity(c);
  await next();
});
recordRoutes.get("/", async (c) => {
  const page = Math.max(
    1,
    Math.min(10000, Math.trunc(Number(c.req.query("page"))) || 1),
  );
  const pageSize = Math.max(
    1,
    Math.min(50, Math.trunc(Number(c.req.query("pageSize"))) || 10),
  );
  const search = (c.req.query("q") || "").slice(0, 160);
  const db = drizzle(c.env.DB);
  const filter = and(
    eq(records.ownerId, c.get("identity").userId),
    search
      ? sql`instr(lower(${records.title}), lower(${search})) > 0`
      : undefined,
  );
  const [items, total] = await Promise.all([
    db
      .select({
        id: records.id,
        title: records.title,
        content: records.content,
        createdAt: records.createdAt,
        updatedAt: records.updatedAt,
      })
      .from(records)
      .where(filter)
      .orderBy(desc(records.updatedAt), desc(records.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(records).where(filter),
  ]);
  return c.json({ items, total: total[0].n, page, pageSize });
});
recordRoutes.post("/", bodyLimit({ maxSize: 420000 }), async (c) => {
  const parsed = recordInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid record" }, 400);
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    ownerId: c.get("identity").userId,
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
  };
  await drizzle(c.env.DB).insert(records).values(row);
  return c.json(
    { id: row.id, ...parsed.data, createdAt: now, updatedAt: now },
    201,
  );
});
recordRoutes.get("/:id", async (c) => {
  const row = await drizzle(c.env.DB)
    .select({
      id: records.id,
      title: records.title,
      content: records.content,
      createdAt: records.createdAt,
      updatedAt: records.updatedAt,
    })
    .from(records)
    .where(
      and(
        eq(records.id, c.req.param("id")),
        eq(records.ownerId, c.get("identity").userId),
      ),
    )
    .get();
  if (!row) return c.json({ error: "Record not found" }, 404);
  const files = await c.env.DB.prepare(
    "SELECT id,name,size,content_type AS contentType FROM files WHERE record_id=? AND owner_id=? AND state='ready' ORDER BY created_at,id",
  )
    .bind(row.id, c.get("identity").userId)
    .all();
  return c.json({ ...row, files: files.results });
});
recordRoutes.patch("/:id", bodyLimit({ maxSize: 420000 }), async (c) => {
  const parsed = recordInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid record" }, 400);
  const row = await drizzle(c.env.DB)
    .update(records)
    .set({ ...parsed.data, updatedAt: Date.now() })
    .where(
      and(
        eq(records.id, c.req.param("id")),
        eq(records.ownerId, c.get("identity").userId),
      ),
    )
    .returning({
      id: records.id,
      title: records.title,
      content: records.content,
      createdAt: records.createdAt,
      updatedAt: records.updatedAt,
    })
    .get();
  return row ? c.json(row) : c.json({ error: "Record not found" }, 404);
});
recordRoutes.delete("/:id", async (c) => {
  const owner = c.get("identity").userId;
  const id = c.req.param("id");
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE files SET state='deleting',cleanup_at=0 WHERE record_id=? AND owner_id=?",
    ).bind(id, owner),
    c.env.DB.prepare("DELETE FROM records WHERE id=? AND owner_id=?").bind(
      id,
      owner,
    ),
  ]);
  if (!result[1].meta.changes)
    return c.json({ error: "Record not found" }, 404);
  await maintainFiles(c.env);
  return c.body(null, 204);
});
