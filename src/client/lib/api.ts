export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new ApiError(response.status, body.error || "Request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const json = (body: unknown) => JSON.stringify(body);
