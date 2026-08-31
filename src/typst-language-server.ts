import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tinymistExecutable } from "./tinymist";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type LanguageServerEvent =
  | {
      type: "status";
      status: "starting" | "ready" | "unavailable";
      message?: string;
    }
  | { type: "diagnostics"; diagnostics: unknown[] }
  | { type: "highlights"; highlights: TypstHighlight[] };

type TypstHighlight = {
  line: number;
  start: number;
  length: number;
  type: string;
};
type CompletionItem = {
  label?: string;
  detail?: string;
  kind?: number;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: CompletionTextEdit;
  additionalTextEdits?: CompletionTextEdit[];
};
type CompletionTextEdit = {
  newText?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

function expandSnippet(snippet: string) {
  const tabStops: { index: number; offset: number }[] = [];
  let text = snippet.replace(
    /\$\{(\d+):([^}]*)\}/g,
    (_match, index: string, placeholder: string, offset: number) => {
      tabStops.push({ index: Number(index), offset });
      return placeholder;
    },
  );
  text = text.replace(
    /\$\{(\d+)\}|\$(\d+)/g,
    (_match, braced: string | undefined, plain: string | undefined, offset) => {
      tabStops.push({ index: Number(braced ?? plain), offset });
      return "";
    },
  );
  const first =
    tabStops
      .filter(({ index }) => index > 0)
      .sort((left, right) => left.index - right.index)[0] ??
    tabStops.find(({ index }) => index === 0);
  return { text, cursorOffset: first?.offset ?? text.length };
}

export class TypstLanguageServer {
  private process: ChildProcessWithoutNullStreams | undefined;
  private directory: string | undefined;
  private documentPath: string | undefined;
  private documentUri: string | undefined;
  private output = Buffer.alloc(0);
  private nextRequestId = 1;
  private version = 0;
  private opened = false;
  private semanticTokenTypes: string[] = [];
  private starting: Promise<void> | undefined;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly emit: (event: LanguageServerEvent) => void) {}

  async sync(source: string) {
    try {
      await this.start();
      if (!this.process || !this.documentPath || !this.documentUri) {
        return { available: false as const };
      }

      await writeFile(this.documentPath, source, "utf8");
      this.version += 1;
      if (!this.opened) {
        this.notify("textDocument/didOpen", {
          textDocument: {
            uri: this.documentUri,
            languageId: "typst",
            version: this.version,
            text: source,
          },
        });
        this.opened = true;
      } else {
        this.notify("textDocument/didChange", {
          textDocument: { uri: this.documentUri, version: this.version },
          contentChanges: [{ text: source }],
        });
      }
      void this.refreshSemanticTokens(this.version);
      return { available: true as const };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Tinymist could not be started.";
      this.emit({ type: "status", status: "unavailable", message });
      return { available: false as const, message };
    }
  }

  async complete(source: string, line: number, character: number) {
    const synchronized = await this.sync(source);
    if (!synchronized.available || !this.documentUri) return [];
    try {
      const response = (await this.request("textDocument/completion", {
        textDocument: { uri: this.documentUri },
        position: { line, character },
        context: { triggerKind: 1 },
      })) as CompletionItem[] | { items?: CompletionItem[] } | null;
      const items = Array.isArray(response)
        ? response
        : (response?.items ?? []);
      return items
        .flatMap((item) => {
          if (!item.label) return [];
          const rawInsertText =
            item.textEdit?.newText ?? item.insertText ?? item.label;
          const expanded =
            item.insertTextFormat === 2
              ? expandSnippet(rawInsertText)
              : { text: rawInsertText, cursorOffset: rawInsertText.length };
          const edits = item.textEdit?.range
            ? [
                {
                  range: item.textEdit.range,
                  newText: expanded.text,
                  cursorOffset: expanded.cursorOffset,
                  primary: true,
                },
                ...(item.additionalTextEdits ?? []).flatMap((edit) =>
                  edit.range
                    ? [{ range: edit.range, newText: edit.newText ?? "" }]
                    : [],
                ),
              ]
            : undefined;
          return [
            {
              label: item.label,
              detail: item.detail,
              kind: item.kind,
              insertText: expanded.text,
              cursorOffset: expanded.cursorOffset,
              edits,
            },
          ];
        })
        .slice(0, 200);
    } catch {
      return [];
    }
  }

  async stop() {
    const child = this.process;
    this.process = undefined;
    if (child && !child.killed) {
      try {
        await this.request("shutdown", null, child);
        this.notify("exit", undefined, child);
      } catch {
        child.kill();
      }
    }
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true });
    this.directory = undefined;
    this.documentPath = undefined;
    this.documentUri = undefined;
  }

  private start() {
    if (this.process) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startProcess() {
    this.emit({ type: "status", status: "starting" });
    this.directory = await mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "blocks-tinymist-"),
    );
    this.documentPath = path.join(this.directory, "document.typ");
    this.documentUri = pathToFileURL(this.documentPath).href;

    const child = spawn(tinymistExecutable(), ["lsp"], {
      cwd: this.directory,
    });
    this.process = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => {
      if (this.process === child) this.process = undefined;
      this.fail(error);
    });
    child.on("exit", (code) => {
      if (this.process !== child) return;
      this.process = undefined;
      this.fail(
        new Error(
          `Tinymist exited${code === null ? "" : ` with code ${code}`}.`,
        ),
      );
    });

    const rootUri = pathToFileURL(this.directory).href;
    const initializeResult = await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "Blocks" }],
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didSave: false, dynamicRegistration: false },
          semanticTokens: {
            dynamicRegistration: false,
            requests: { full: true },
            tokenTypes: [
              "namespace",
              "type",
              "class",
              "enum",
              "interface",
              "struct",
              "typeParameter",
              "parameter",
              "variable",
              "property",
              "enumMember",
              "event",
              "function",
              "method",
              "macro",
              "keyword",
              "modifier",
              "comment",
              "string",
              "number",
              "regexp",
              "operator",
              "decorator",
            ],
            tokenModifiers: [],
            formats: ["relative"],
          },
        },
        workspace: { workspaceFolders: true },
      },
      clientInfo: { name: "Blocks", version: "1.0.0" },
    });
    const capabilities = (
      initializeResult as
        | {
            capabilities?: {
              semanticTokensProvider?: { legend?: { tokenTypes?: string[] } };
            };
          }
        | undefined
    )?.capabilities;
    this.semanticTokenTypes =
      capabilities?.semanticTokensProvider?.legend?.tokenTypes ?? [];
    this.notify("initialized", {});
    this.emit({ type: "status", status: "ready" });
  }

  private request(method: string, params: unknown, child = this.process) {
    if (!child) return Promise.reject(new Error("Tinymist is not running."));
    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params }, child);
    });
  }

  private notify(method: string, params?: unknown, child = this.process) {
    if (!child) return;
    this.send(
      { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) },
      child,
    );
  }

  private send(message: object, child: ChildProcessWithoutNullStreams) {
    const body = JSON.stringify(message);
    child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }

  private consume(chunk: Buffer) {
    this.output = Buffer.concat([this.output, chunk]);
    for (;;) {
      const headerEnd = this.output.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.output.subarray(0, headerEnd).toString("ascii");
      const match = /(?:^|\r\n)Content-Length: (\d+)/i.exec(header);
      if (!match) {
        this.output = this.output.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.output.length < bodyStart + length) return;
      const body = this.output
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.output = this.output.subarray(bodyStart + length);
      try {
        this.receive(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Ignore malformed output and continue reading the stream.
      }
    }
  }

  private receive(message: JsonRpcMessage) {
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as
        { uri?: string; diagnostics?: unknown[] } | undefined;
      if (params?.uri === this.documentUri) {
        const diagnostics = params?.diagnostics ?? [];
        this.emit({ type: "diagnostics", diagnostics });
      }
      return;
    }

    // Tinymist occasionally asks clients for configuration. Empty settings use
    // its defaults and keep the protocol moving.
    if (typeof message.id === "number" && message.method) {
      this.send(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: message.method === "workspace/configuration" ? [] : null,
        },
        this.process!,
      );
    }
  }

  private async refreshSemanticTokens(version: number) {
    if (!this.documentUri || this.semanticTokenTypes.length === 0) return;
    try {
      const response = (await this.request("textDocument/semanticTokens/full", {
        textDocument: { uri: this.documentUri },
      })) as { data?: number[] } | null;
      if (version !== this.version) return;
      const data = response?.data ?? [];
      const highlights: TypstHighlight[] = [];
      let line = 0;
      let start = 0;
      for (let index = 0; index + 4 < data.length; index += 5) {
        const deltaLine = data[index];
        line += deltaLine;
        start = deltaLine === 0 ? start + data[index + 1] : data[index + 1];
        highlights.push({
          line,
          start,
          length: data[index + 2],
          type: this.semanticTokenTypes[data[index + 3]] ?? "variable",
        });
      }
      this.emit({ type: "highlights", highlights });
    } catch {
      // Semantic highlighting is optional; diagnostics still work without it.
    }
  }

  private fail(error: Error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.emit({
      type: "status",
      status: "unavailable",
      message: error.message,
    });
  }
}
