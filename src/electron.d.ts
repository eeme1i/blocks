export {};

declare global {
  type OpenDocumentResult = { filePath: string; contents: string };
  type SaveDocumentResult = { filePath: string };
  type CompileResult = { ok: true; pdf: string } | { ok: false; error: string };
  type ExportResult =
    | { ok: true; filePath: string }
    | { ok: false; canceled: boolean; error: string };
  type FileCommand = "open" | "save" | "save-as";
  type TypstPosition = { line: number; character: number };
  type TypstDiagnostic = {
    range: { start: TypstPosition; end: TypstPosition };
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
  };
  type TypstHighlight = {
    line: number;
    start: number;
    length: number;
    type: string;
  };
  type TypstCompletion = {
    label: string;
    detail?: string;
    kind?: number;
    insertText: string;
  };
  type TypstLanguageServerEvent =
    | {
        type: "status";
        status: "starting" | "ready" | "unavailable";
        message?: string;
      }
    | { type: "diagnostics"; diagnostics: TypstDiagnostic[] }
    | { type: "highlights"; highlights: TypstHighlight[] };

  interface Window {
    writer: {
      newWindow(): Promise<void>;
      openDocument(): Promise<OpenDocumentResult | null>;
      saveDocument(contents: string): Promise<SaveDocumentResult | null>;
      saveDocumentAs(contents: string): Promise<SaveDocumentResult | null>;
      compileTypst(source: string): Promise<CompileResult>;
      exportPdf(source: string): Promise<ExportResult>;
      exportTypst(source: string): Promise<SaveDocumentResult | null>;
      syncTypstLanguageServer(
        source: string,
      ): Promise<{ available: boolean; message?: string }>;
      completeTypst(
        source: string,
        line: number,
        character: number,
      ): Promise<TypstCompletion[]>;
      onTypstLanguageServerEvent(
        callback: (event: TypstLanguageServerEvent) => void,
      ): () => void;
      onFileCommand(callback: (command: FileCommand) => void): () => void;
    };
  }
}
