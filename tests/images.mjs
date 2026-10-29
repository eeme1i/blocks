import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  importAsset,
  readDocumentBundle,
  writeDocumentBundle,
  writeAssets,
  referencedAssets,
} from "../src/assets.ts";
import {
  blockLabel,
  blockToTypst,
  createBlock,
  documentToTypst,
  typstBlockRanges,
} from "../src/model/document.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

test("bundle preserves original images, alternatives and Save As copies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blocks-images-test-"));
  try {
    const store = new Map();
    const asset = importAsset(store, "original.png", png);
    assert.equal(importAsset(store, "renamed.png", png).id, asset.id);
    const block = createBlock("Text");
    const alternative = createBlock();
    alternative.image = {
      assetId: asset.id,
      caption: "Caption",
      alt: "Description",
      width: 70,
    };
    block.alternatives.push(alternative);
    const contents = JSON.stringify({ version: 1, blocks: [block] });
    const bundle = path.join(directory, "first.blocks");
    await writeDocumentBundle(bundle, contents, store);
    const opened = await readDocumentBundle(bundle);
    assert.equal(opened.contents, contents);
    assert.deepEqual(opened.store.get(asset.id).bytes, png);
    const copy = path.join(directory, "copy.blocks");
    await writeDocumentBundle(copy, opened.contents, opened.store);
    assert.deepEqual(
      (await readDocumentBundle(copy)).store.get(asset.id).bytes,
      png,
    );
    await writeFile(
      path.join(bundle, "assets", asset.id),
      Buffer.from("corrupt"),
    );
    await assert.rejects(readDocumentBundle(bundle));
    const legacy = path.join(directory, "legacy.blocks");
    await writeFile(
      legacy,
      JSON.stringify({ version: 1, blocks: [createBlock("Legacy")] }),
    );
    assert.equal((await readDocumentBundle(legacy)).store.size, 0);
    await assert.rejects(
      writeDocumentBundle(legacy, contents, store),
      /Save As/,
    );
    assert.throws(
      () =>
        referencedAssets(
          JSON.stringify({ blocks: [{ image: { assetId: "../secret" } }] }),
        ),
      /Invalid/,
    );
    assert.throws(() =>
      importAsset(store, "bad.png", Buffer.from("not an image")),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generated image markup escapes captions and preserves following block ranges", async () => {
  const store = new Map();
  const asset = importAsset(store, "image.png", png);
  const image = createBlock();
  image.image = {
    assetId: asset.id,
    caption: 'Literal # text [brackets] "quotes"\nand newline',
    alt: 'A "quoted" image',
    width: 60,
  };
  const document = {
    version: 1,
    blocks: [image, createBlock("Following paragraph")],
  };
  const source = documentToTypst(document);
  const ranges = typstBlockRanges(document);
  assert.equal(source.split("\n")[ranges[1].startLine], "Following paragraph");
  assert.match(source, /width: 60%/);
  const directory = process.env.BLOCKS_IMAGE_FIXTURE;
  if (directory) {
    await writeAssets(directory, store);
    await writeFile(path.join(directory, "document.typ"), source);
  }
});

test("images and paragraphs have independent display counters", () => {
  const image = createBlock();
  image.image = { assetId: "image.png", caption: "", alt: "", width: 100 };
  const document = {
    version: 1,
    blocks: [createBlock("First"), image, createBlock("Second")],
  };
  assert.deepEqual(
    document.blocks.map((_, index) => blockLabel(document, index)),
    ["Paragraph 1", "Image 1", "Paragraph 2"],
  );
});

test("full image expressions and explicit figure settings survive serialization", () => {
  const image = createBlock();
  image.image = {
    assetId: "test.png",
    caption: "Literal # caption",
    alt: "",
    width: 100,
    source: "bytes((255, 0, 0))",
    parameters: {
      format: '(encoding: "rgb8", width: 1, height: 1)',
      width: "2cm",
      height: "1cm",
      alt: "none",
      page: "1",
      fit: '"contain"',
      scaling: '"pixelated"',
      icc: "auto",
    },
    figure: false,
  };
  assert.match(blockToTypst(image), /^#image\(bytes/);
  for (const [name, value] of Object.entries(image.image.parameters))
    assert.ok(blockToTypst(image).includes(`${name}: ${value}`));
  image.image.figure = true;
  image.image.label = "example";
  image.image.figureParameters = { numbering: "none", placement: "none" };
  const source = blockToTypst(JSON.parse(JSON.stringify(image)));
  assert.match(source, /^#figure\(image/);
  assert.ok(source.includes("numbering: none"));
  assert.ok(source.endsWith('#label("example")'));
  image.image.caption = "";
  assert.match(blockToTypst(image), /^#figure/);
  if (process.env.BLOCKS_IMAGE_FIXTURE)
    return writeFile(
      path.join(process.env.BLOCKS_IMAGE_FIXTURE, "parameters.typ"),
      source,
    );
});
