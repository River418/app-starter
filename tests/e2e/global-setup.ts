import { readFileSync } from "node:fs";
export default async function setup() {
  const users = JSON.parse(readFileSync(".local/e2e-users.json", "utf8"));
  const response = await fetch("http://localhost:5173/api/auth/bootstrap", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: users.bootstrapToken, ...users.admin }),
  });
  if (response.status !== 201)
    throw new Error(`E2E bootstrap failed ${response.status}`);
}
