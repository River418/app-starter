import { env } from "cloudflare:workers";
import { expect, test, vi } from "vitest";
import { app } from "../../src/server/app";
import { user, request } from "./fixtures";
import { maintainFiles } from "../../src/server/maintenance";

test("failed attachment binding cleans the actual R2 object", async () => {
  const owner = await user();
  const record = (await (
    await request("/api/records", {
      method: "POST",
      cookie: owner.cookie(),
      body: { title: "Race", content: "" },
    })
  ).json()) as { id: string };
  const put = env.FILES.put.bind(env.FILES);
  const hook = vi
    .spyOn(env.FILES, "put")
    .mockImplementationOnce(
      async (...args: Parameters<typeof env.FILES.put>) => {
        await env.DB.prepare("DELETE FROM records WHERE id=?")
          .bind(record.id)
          .run();
        return put(...args);
      },
    );
  try {
    const response = await app.request(
      `http://localhost:5173/api/records/${record.id}/files`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173",
          Cookie: owner.cookie(),
          "X-File-Name": "raced.txt",
        },
        body: "must be cleaned",
      },
      env,
    );
    expect(response.status).toBe(500);
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM files").first("n"),
    ).toBe(0);
  } finally {
    hook.mockRestore();
  }
});
test("cleanup is capped at 20 and unfinished tombstones discover late objects", async () => {
  const owner = await user();
  const statements = [];
  for (let i = 0; i < 25; i++)
    statements.push(
      env.DB.prepare(
        "INSERT INTO files(id,owner_id,object_key,name,content_type,size,state,created_at,upload_complete) VALUES(?,?,?,'a','text/plain',1,'deleting',?,1)",
      ).bind(crypto.randomUUID(), owner.id, `bounded/${i}`, Date.now()),
    );
  await env.DB.batch(statements);
  expect((await maintainFiles(env)).inspected).toBe(20);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM files").first("n"),
  ).toBe(5);
  await maintainFiles(env);
  const id = crypto.randomUUID();
  const key = `${owner.id}/${id}`;
  await env.DB.prepare(
    "INSERT INTO files(id,owner_id,object_key,name,content_type,size,state,created_at) VALUES(?,?,?,'a','text/plain',0,'pending',?)",
  )
    .bind(id, owner.id, key, Date.now() - 3600000)
    .run();
  await maintainFiles(env);
  expect(
    await env.DB.prepare("SELECT state FROM files WHERE id=?")
      .bind(id)
      .first("state"),
  ).toBe("deleting");
  await env.FILES.put(key, "late");
  await env.DB.prepare("UPDATE files SET cleanup_at=0 WHERE id=?")
    .bind(id)
    .run();
  await maintainFiles(env);
  expect(await env.FILES.get(key)).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM files WHERE id=?").bind(id).first(),
  ).not.toBeNull();
});

test("records pagination/search and owner boundaries are enforced by real API and D1", async () => {
  const owner = await user();
  const other = await user();
  const ids: string[] = [];
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    const res = await request("/api/records", {
      method: "POST",
      cookie: owner.cookie(),
      body: { title, content: "Some text" },
    });
    expect(res.status).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  const page = await request("/api/records?page=2&pageSize=2", {
    cookie: owner.cookie(),
  });
  expect(await page.json()).toMatchObject({
    total: 3,
    page: 2,
    items: expect.any(Array),
  });
  const search = await request("/api/records?q=Beta", {
    cookie: owner.cookie(),
  });
  expect(((await search.json()) as { total: number }).total).toBe(1);
  for (const method of ["GET", "PATCH", "DELETE"])
    expect(
      (
        await request(`/api/records/${ids[0]}`, {
          method,
          cookie: other.cookie(),
          ...(method === "PATCH"
            ? { body: { title: "Stolen", content: "" } }
            : {}),
        })
      ).status,
    ).toBe(404);
  expect(
    (
      await request(`/api/records/${ids[0]}`, {
        method: "PATCH",
        cookie: owner.cookie(),
        body: { title: "Updated", content: "Saved" },
      })
    ).status,
  ).toBe(200);
});
test("files remain private, streamed size cap rejects lies, duplicate deletes are safe", async () => {
  const owner = await user();
  const other = await user();
  const record = (await (
    await request("/api/records", {
      method: "POST",
      cookie: owner.cookie(),
      body: { title: "Attachments", content: "" },
    })
  ).json()) as { id: string };
  const upload = await app.request(
    `http://localhost:5173/api/records/${record.id}/files`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        Cookie: owner.cookie(),
        "X-File-Name": encodeURIComponent("draft.txt"),
        "Content-Type": "text/plain",
      },
      body: "private text",
    },
    env,
  );
  expect(upload.status).toBe(201);
  const file = (await upload.json()) as { id: string };
  expect(
    (await request(`/api/files/${file.id}`, { cookie: other.cookie() })).status,
  ).toBe(404);
  const download = await request(`/api/files/${file.id}`, {
    cookie: owner.cookie(),
  });
  expect(await download.text()).toBe("private text");
  expect(download.headers.get("content-disposition")).toContain("attachment;");
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  const tooLarge = await app.request(
    `http://localhost:5173/api/records/${record.id}/files`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        Cookie: owner.cookie(),
        "X-File-Name": "large.bin",
      },
      body: oversized,
      duplex: "half",
    } as RequestInit,
    env,
  );
  expect(tooLarge.status).toBe(413);
  expect(
    (
      await request(`/api/files/${file.id}`, {
        method: "DELETE",
        cookie: owner.cookie(),
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await request(`/api/files/${file.id}`, {
        method: "DELETE",
        cookie: owner.cookie(),
      })
    ).status,
  ).toBe(204);
  expect((await env.FILES.list()).objects).toHaveLength(0);
});
test("record delete tracks attachments and bounded maintenance retries failed R2 cleanup", async () => {
  const owner = await user();
  const record = (await (
    await request("/api/records", {
      method: "POST",
      cookie: owner.cookie(),
      body: { title: "Delete with attachment", content: "" },
    })
  ).json()) as { id: string };
  const upload = await app.request(
    `http://localhost:5173/api/records/${record.id}/files`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        Cookie: owner.cookie(),
        "X-File-Name": "delete.txt",
      },
      body: "orphan",
    },
    env,
  );
  expect(upload.status).toBe(201);
  const { id } = (await upload.json()) as { id: string };
  const key = await env.DB.prepare("SELECT object_key FROM files WHERE id=?")
    .bind(id)
    .first<string>("object_key");
  expect(key).toBeTruthy();
  const remove = vi
    .spyOn(env.FILES, "delete")
    .mockRejectedValueOnce(new Error("temporary unavailable"));
  expect(
    (
      await request(`/api/records/${record.id}`, {
        method: "DELETE",
        cookie: owner.cookie(),
      })
    ).status,
  ).toBe(204);
  expect(
    (await request(`/api/records/${record.id}`, { cookie: owner.cookie() }))
      .status,
  ).toBe(404);
  expect(
    await env.DB.prepare("SELECT state FROM files WHERE id=?")
      .bind(id)
      .first("state"),
  ).toBe("deleting");
  remove.mockRestore();
  await env.DB.prepare("UPDATE files SET cleanup_at=0 WHERE id=?")
    .bind(id)
    .run();
  await maintainFiles(env);
  expect(await env.FILES.get(key!)).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM files WHERE id=?").bind(id).first(),
  ).toBeNull();
});
