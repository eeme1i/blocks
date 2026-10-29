import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Bundle with Solid's browser runtime: its memos execute eagerly, unlike the
// server runtime selected by a normal Node import.
const bundle = await build({
  stdin: {
    contents:
      'export { createWriterState } from "./src/state/writer"; export { createRoot } from "solid-js";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  conditions: ["browser"],
});
const directory = await mkdtemp(path.join(tmpdir(), "blocks-startup-test-"));
let createWriterState, createRoot;
try {
  const entry = path.join(directory, "writer.mjs");
  await writeFile(entry, bundle.outputFiles[0].text);
  ({ createWriterState, createRoot } = await import(pathToFileURL(entry).href));
} finally {
  await rm(directory, { recursive: true, force: true });
}

test("writer starts, tracks selection and handles native Open commands", async () => {
  const previousWindow = globalThis.window;
  let fileCommand;
  let opened = 0;
  let cleanedUp = 0;
  globalThis.window = {
    localStorage: { getItem: () => null },
    setTimeout: () => 1,
    clearTimeout: () => {},
    writer: {
      newWindow: async () => {},
      onTypstLanguageServerEvent: () => () => {
        cleanedUp++;
      },
      onFileCommand: (callback) => {
        fileCommand = callback;
        return () => {
          cleanedUp++;
        };
      },
      openDocument: async () => {
        opened++;
        return {
          filePath: "/tmp/opened.blocks",
          assets: [],
          contents: JSON.stringify({
            version: 1,
            blocks: [
              { id: "opened", content: "Opened document", alternatives: [] },
            ],
          }),
        };
      },
    },
  };
  let dispose;
  try {
    const writer = createRoot((cleanup) => {
      dispose = cleanup;
      return createWriterState();
    });
    assert.equal(writer.activeBlock().id, "opening");
    writer.setSelected({ primaryId: "opening", alternativeId: "opening-alt" });
    assert.equal(writer.activeBlock().id, "opening-alt");
    assert.equal(typeof fileCommand, "function");
    fileCommand("open");
    await Promise.resolve();
    assert.equal(opened, 1);
    assert.equal(writer.filePath(), "/tmp/opened.blocks");
    assert.equal(writer.activeBlock().content, "Opened document");
  } finally {
    dispose?.();
    globalThis.window = previousWindow;
  }
  assert.equal(cleanedUp, 2);
});
