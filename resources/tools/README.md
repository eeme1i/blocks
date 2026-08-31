# Bundled Tinymist

Stage the Tinymist executable for the current build target before packaging:

```sh
pnpm tools:stage
pnpm package
```

Set `TINYMIST_BINARY` when Tinymist is not available on `PATH`:

```sh
TINYMIST_BINARY=/path/to/tinymist pnpm tools:stage
```

The staging script writes to `resources/tools/<platform>-<architecture>/`.
These generated binaries stay outside Git. Release automation must download a
pinned Tinymist version, verify its checksum, and then run the staging command.

Electron Forge copies the selected executable beside `app.asar`. The packaged
application uses that copy for both the language server and compilation.
