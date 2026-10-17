import { readFile } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";
export async function readWranglerConfig(path = "wrangler.jsonc") {
  const errors = [];
  const config = parse(await readFile(path, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length)
    throw new Error(
      `Invalid Wrangler JSONC: ${printParseErrorCode(errors[0].error)}`,
    );
  return config;
}
