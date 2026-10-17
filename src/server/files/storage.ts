import { HTTPException } from "hono/http-exception";
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new HTTPException(413, { message: "File exceeds size limit" });
  if (!request.body) throw new HTTPException(400, { message: "File is empty" });
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + 30000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new HTTPException(408, { message: "Upload timed out" })),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes)
        throw new HTTPException(413, { message: "File exceeds size limit" });
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new HTTPException(400, { message: "File is empty" });
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
