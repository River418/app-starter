import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parse } from "@babel/parser";
import { pathToFileURL } from "node:url";

export function checkBoundaries(root) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.[cm]?tsx?$/.test(item.name)) files.push(path);
    }
  };
  walk(resolve(root, "src"));
  if (!files.length) throw new Error("No application sources found");
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (
      !/(^src\/(client|shared)\/|\/features\/[^/]+\/(client|shared)\/)/.test(
        name,
      )
    )
      continue;
    const source = parse(readFileSync(path, "utf8"), {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    const visit = (node) => {
      let specifier;
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].includes(node.type) &&
        node.source
      )
        specifier = node.source.value;
      if (node.type === "ImportExpression") {
        if (node.source.type !== "StringLiteral")
          throw new Error(`Boundary: nonliteral import in ${name}`);
        specifier = node.source.value;
      }
      if (node.type === "CallExpression" && node.callee?.name === "require") {
        if (node.arguments[0]?.type !== "StringLiteral")
          throw new Error(`Boundary: nonliteral import in ${name}`);
        specifier = node.arguments[0].value;
      }
      if (specifier) {
        const target = (
          specifier.startsWith(".") ? resolve(path, "..", specifier) : specifier
        ).replaceAll("\\", "/");
        if (
          /(\/server\/|\/probes\/|\/app\.config(?:\.[cm]?ts)?$|^node:|^cloudflare:|^better-auth|^drizzle-orm|^stripe$)/.test(
            target,
          )
        )
          throw new Error(`Boundary: ${name} imports ${specifier}`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value))
          for (const child of value) {
            if (child?.type) visit(child);
          }
        else if (value && typeof value === "object" && "type" in value)
          visit(value);
      }
    };
    visit(source);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkBoundaries(process.cwd());
  console.log("Client/shared boundaries pass");
}
