import type { Bindings } from "./types";
export async function maintainFiles(env: Pick<Bindings, "DB" | "FILES">) {
  const now = Date.now();
  const candidates = await env.DB.prepare(
    "SELECT id,object_key,upload_complete FROM files WHERE (state='deleting' AND cleanup_at<=?) OR (state='pending' AND created_at<?) ORDER BY cleanup_at,created_at LIMIT 20",
  )
    .bind(now, now - 15 * 60 * 1000)
    .all<{ id: string; object_key: string; upload_complete: number }>();
  for (const file of candidates.results) {
    // Mark before deleting R2. Keep an unfinished-upload tombstone so a late put remains discoverable.
    const claim = await env.DB.prepare(
      "UPDATE files SET state='deleting',cleanup_at=? WHERE id=? AND state IN('pending','deleting')",
    )
      .bind(now + 60000, file.id)
      .run();
    if (!claim.meta.changes) continue;
    try {
      await env.FILES.delete(file.object_key);
      if (file.upload_complete)
        await env.DB.prepare(
          "DELETE FROM files WHERE id=? AND state='deleting' AND upload_complete=1",
        )
          .bind(file.id)
          .run();
    } catch {
      /* journal remains; next bounded sweep retries */
    }
  }
  return { inspected: candidates.results.length };
}
