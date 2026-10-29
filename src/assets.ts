import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredAsset = { id: string; name: string; bytes: Buffer };
export type AssetStore = Map<string, StoredAsset>;

export function importAsset(
  store: AssetStore,
  name: string,
  bytes: Uint8Array,
) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 50 * 1024 * 1024)
    throw new Error("Choose an image smaller than 50 MB.");
  const buffer = Buffer.from(bytes);
  const extension = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      ? "jpg"
      : /GIF8[79]a/.test(buffer.subarray(0, 6).toString())
        ? "gif"
        : buffer.subarray(0, 4).toString() === "RIFF" &&
            buffer.subarray(8, 12).toString() === "WEBP"
          ? "webp"
          : null;
  if (!extension) throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
  const id = `${createHash("sha256").update(buffer).digest("hex")}.${extension}`;
  const asset = { id, name: path.basename(name), bytes: buffer };
  store.set(id, asset);
  return asset;
}

export function publicAsset(asset: StoredAsset) {
  const extension = asset.id.split(".").pop();
  return {
    id: asset.id,
    name: asset.name,
    url: `data:image/${extension === "jpg" ? "jpeg" : extension};base64,${asset.bytes.toString("base64")}`,
  };
}

export function referencedAssets(contents: string): Set<string> {
  const document = JSON.parse(contents);
  const ids = new Set<string>();
  const visit = (
    blocks: { image?: { assetId: string }; alternatives?: unknown[] }[],
  ) => {
    for (const block of blocks) {
      if (block.image) {
        if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(block.image.assetId))
          throw new Error("Invalid image asset reference.");
        ids.add(block.image.assetId);
      }
      visit((block.alternatives ?? []) as typeof blocks);
    }
  };
  visit(document.blocks ?? []);
  return ids;
}

export async function writeAssets(directory: string, store: AssetStore) {
  if (!store.size) return;
  await mkdir(path.join(directory, "assets"), { recursive: true });
  for (const asset of store.values())
    await writeFile(path.join(directory, "assets", asset.id), asset.bytes, {
      flag: "wx",
    }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
}

export async function readDocumentBundle(filePath: string) {
  const bundle = (await stat(filePath)).isDirectory();
  const contents = await readFile(
    bundle ? path.join(filePath, "document.json") : filePath,
    "utf8",
  );
  const store: AssetStore = new Map();
  if (bundle)
    for (const id of referencedAssets(contents)) {
      const asset = importAsset(
        store,
        id,
        await readFile(path.join(filePath, "assets", id)),
      );
      if (asset.id !== id) throw new Error(`Image asset is damaged: ${id}`);
    }
  return { contents, store };
}

export async function writeDocumentBundle(
  filePath: string,
  contents: string,
  store: AssetStore,
) {
  const ids = referencedAssets(contents);
  for (const id of ids)
    if (!store.has(id)) throw new Error(`Missing image asset: ${id}`);
  const existing = await stat(filePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  // Existing plain JSON documents remain plain until saved as a new bundle.
  if (existing?.isFile()) {
    if (ids.size)
      throw new Error("Use Save As to save images in a new .blocks bundle.");
    await writeFile(filePath, contents, "utf8");
    return;
  }
  await mkdir(filePath, { recursive: true });
  await writeAssets(
    filePath,
    new Map([...store].filter(([id]) => ids.has(id))),
  );
  const temporary = path.join(filePath, `document-${Date.now()}.tmp`);
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path.join(filePath, "document.json"));
}
