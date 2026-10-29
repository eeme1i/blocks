# Blocks

A desktop writing board with a primary document spine and alternate blocks.

## Images

Use **+ Image**, drop images on the board, or paste an image from the clipboard.
PNG, JPEG, GIF, and WebP originals up to 50 MB are supported. Use the image card to
edit parameters directly inside the card. Width and height accept Typst expressions
such as `auto`, `80%`, or `8cm`; resizing the board card does not change output size.
The advanced controls expose source, format, page, fit, scaling, and ICC expressions.
Strings must be quoted, and blank fields restore defaults.

Enable **Wrap in figure** for a caption, reference label, numbering and placement.
Advanced figure controls also expose scope, kind, supplement, gap, and outlined.
Turning the wrapper off preserves its settings. Image and paragraph card numbers
are independent; figure numbers in the compiled document are managed by Typst. **+ Alternate** on an image imports an image alternative, which
can be promoted with **Make primary**.

New documents save as `.blocks` directory bundles containing `document.json`
and an `assets/` directory. Move or share the entire bundle. Assets have stable,
content-derived filenames, and assets referenced by alternatives are preserved.
Existing JSON `.blocks` files still open; use **Save As** with a new filename to
save one containing images as a bundle.

Preview and PDF export resolve imported images automatically. Typst source
export writes an `assets/` directory beside the `.typ` file; keep these together.
Captions and alt text in image properties are plain text. Use a paragraph block
for custom Typst figure markup.

## Development

- `pnpm start` starts Electron.
- `pnpm typecheck` and `pnpm lint` check the application.
- `node --test tests/images.mjs` checks image storage and source generation
  (requires a Node version with TypeScript type stripping).
