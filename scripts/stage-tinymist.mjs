import { chmod, copyFile, mkdir } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { accessSync, constants } from "node:fs";

const executableName =
  process.platform === "win32" ? "tinymist.exe" : "tinymist";

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

const source = resolve(
  process.env.TINYMIST_BINARY ?? findOnPath(executableName) ?? executableName,
);
const destination = resolve(
  "resources",
  "tools",
  `${process.platform}-${process.arch}`,
  executableName,
);

try {
  accessSync(source, constants.R_OK);
} catch {
  throw new Error(
    "Tinymist was not found. Install it or set TINYMIST_BINARY to its path.",
  );
}

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);

console.log(`Staged ${source} at ${destination}`);
