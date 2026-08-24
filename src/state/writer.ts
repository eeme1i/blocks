import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  type BlocksDocument,
  type Block,
  type Point,
  type Size,
  alternativePosition,
  createBlock,
  defaultAlternativePosition,
  defaultPrimaryPosition,
  documentToTypst,
  getPrimary,
  parseDocument,
  primaryPosition,
  replacePrimary,
  serializeDocument,
  starterDocument,
  translatePrimaryGroup,
  typstBlockRanges,
  updateAlternative,
} from "../model/document";

export type SelectedBlock = { primaryId: string; alternativeId?: string };
export type PreviewState = "idle" | "working" | "error";
export type InspectorPane = "preview" | "typst";
export type Toast = { id: number; message: string; tone: "success" | "error" };
export type LanguageServerStatus = "starting" | "ready" | "unavailable";

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function createWriterState() {
  const [document, setDocument] = createSignal<BlocksDocument>(starterDocument);
  const [filePath, setFilePath] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<SelectedBlock>({
    primaryId: starterDocument.blocks[0].id,
  });
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [previewState, setPreviewState] = createSignal<PreviewState>("idle");
  const [previewError, setPreviewError] = createSignal("");
  const [rightPane, setRightPane] = createSignal<InspectorPane>("preview");
  const [inspectorOpen, setInspectorOpen] = createSignal(false);
  const storedWidth = Number.parseFloat(
    window.localStorage.getItem("blocks:inspector-width") ?? "",
  );
  const [inspectorWidth, setInspectorWidth] = createSignal(
    Number.isFinite(storedWidth) ? Math.max(280, storedWidth) : 380,
  );
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [languageServerStatus, setLanguageServerStatus] =
    createSignal<LanguageServerStatus>("starting");
  const [languageServerMessage, setLanguageServerMessage] = createSignal("");
  const [typstDiagnostics, setTypstDiagnostics] = createSignal<
    TypstDiagnostic[]
  >([]);
  const [typstHighlights, setTypstHighlights] = createSignal<TypstHighlight[]>(
    [],
  );
  const [autoCompile, setAutoCompileSignal] = createSignal(
    window.localStorage.getItem("blocks:auto-compile") === "true",
  );
  let compileRequest = 0;

  const typstSource = createMemo(() => documentToTypst(document()));
  const activePrimary = createMemo(
    () =>
      document().blocks.find((block) => block.id === selected().primaryId) ??
      document().blocks[0],
  );
  const blockRanges = createMemo(() => typstBlockRanges(document()));
  const diagnosticsByBlock = createMemo(() => {
    const grouped = new Map<string, TypstDiagnostic[]>();
    for (const diagnostic of typstDiagnostics()) {
      const range = blockRanges().find(
        ({ startLine, endLine }) =>
          diagnostic.range.start.line >= startLine &&
          diagnostic.range.start.line <= endLine,
      );
      if (!range) continue;
      grouped.set(range.blockId, [
        ...(grouped.get(range.blockId) ?? []),
        diagnostic,
      ]);
    }
    return grouped;
  });
  const diagnosticEntries = createMemo(() =>
    typstDiagnostics().map((diagnostic) => {
      const range = blockRanges().find(
        ({ startLine, endLine }) =>
          diagnostic.range.start.line >= startLine &&
          diagnostic.range.start.line <= endLine,
      );
      const blockIndex = range
        ? document().blocks.findIndex((block) => block.id === range.blockId)
        : -1;
      const displayLine = range
        ? diagnostic.range.start.line -
          range.startLine +
          range.localStartLine +
          1
        : diagnostic.range.start.line + 1;
      return { diagnostic, blockId: range?.blockId, blockIndex, displayLine };
    }),
  );
  const highlightsByBlock = createMemo(() => {
    const grouped = new Map<string, TypstHighlight[]>();
    for (const highlight of typstHighlights()) {
      const range = blockRanges().find(
        ({ startLine, endLine }) =>
          highlight.line >= startLine && highlight.line <= endLine,
      );
      if (!range) continue;
      grouped.set(range.blockId, [
        ...(grouped.get(range.blockId) ?? []),
        {
          ...highlight,
          line: highlight.line - range.startLine + range.localStartLine,
          start:
            highlight.start +
            (highlight.line === range.startLine
              ? range.localStartCharacter
              : 0),
        },
      ]);
    }
    return grouped;
  });

  const removeLanguageServerListener = window.writer.onTypstLanguageServerEvent(
    (event) => {
      if (event.type === "status") {
        setLanguageServerStatus(event.status);
        setLanguageServerMessage(event.message ?? "");
      } else if (event.type === "diagnostics") {
        setTypstDiagnostics(event.diagnostics);
      } else {
        setTypstHighlights(event.highlights);
      }
    },
  );
  onCleanup(removeLanguageServerListener);

  const removeFileCommandListener = window.writer.onFileCommand((command) => {
    if (command === "open") void openDocument();
    if (command === "save") void saveDocument();
    if (command === "save-as") void saveDocumentAs();
  });
  onCleanup(removeFileCommandListener);

  let languageServerTimer: number | undefined;
  createEffect(() => {
    const source = typstSource();
    window.clearTimeout(languageServerTimer);
    languageServerTimer = window.setTimeout(async () => {
      const result = await window.writer.syncTypstLanguageServer(source);
      if (result.available) {
        setLanguageServerStatus("ready");
        setLanguageServerMessage("");
      } else {
        setLanguageServerStatus("unavailable");
        setLanguageServerMessage(
          result.message ??
            "Install Tinymist to enable live Typst diagnostics.",
        );
      }
    }, 180);
  });
  onCleanup(() => window.clearTimeout(languageServerTimer));

  let autoCompileTimer: number | undefined;
  createEffect(() => {
    const source = typstSource();
    const enabled = autoCompile();
    window.clearTimeout(autoCompileTimer);
    if (enabled) {
      autoCompileTimer = window.setTimeout(() => {
        void compileSource(source, false);
      }, 650);
    }
  });
  onCleanup(() => window.clearTimeout(autoCompileTimer));

  createEffect(() => {
    if (!document().blocks.some((block) => block.id === selected().primaryId)) {
      setSelected({ primaryId: document().blocks[0]?.id ?? "" });
    }
  });

  function showToast(message: string, tone: Toast["tone"] = "success") {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      2800,
    );
  }

  async function openDocument() {
    const result = await window.writer.openDocument();
    if (!result) return;
    const next = parseDocument(result.contents);
    if (next === null) {
      showToast("Could not parse document", "error");
    } else {
      setDocument(next);
      setSelected({ primaryId: next.blocks[0]?.id ?? "" });
      setFilePath(result.filePath);
      setPreviewUrl(null);
    }
  }

  async function saveDocument() {
    try {
      const result = await window.writer.saveDocument(
        serializeDocument(document()),
      );
      if (!result) return;
      setFilePath(result.filePath);
      showToast(`Saved ${fileName(result.filePath)}`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not save document",
        "error",
      );
    }
  }

  async function saveDocumentAs() {
    try {
      const result = await window.writer.saveDocumentAs(
        serializeDocument(document()),
      );
      if (!result) return;
      setFilePath(result.filePath);
      showToast(`Saved ${fileName(result.filePath)}`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not save document",
        "error",
      );
    }
  }

  function addPrimary(afterId?: string) {
    const next = createBlock("A new paragraph.");
    setDocument((current) => {
      const index = afterId
        ? current.blocks.findIndex((block) => block.id === afterId)
        : current.blocks.length - 1;
      next.position = defaultPrimaryPosition(index + 1);
      return {
        ...current,
        blocks: [
          ...current.blocks.slice(0, index + 1),
          next,
          ...current.blocks.slice(index + 1),
        ],
      };
    });
    setSelected({ primaryId: next.id });
  }

  function movePrimary(primaryId: string, direction: -1 | 1) {
    setDocument((current) => {
      const index = current.blocks.findIndex((block) => block.id === primaryId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.blocks.length)
        return current;
      const blocks = [...current.blocks];
      const moving = blocks[index];
      const displaced = blocks[destination];
      blocks[destination] = translatePrimaryGroup(
        moving,
        index,
        primaryPosition(displaced, destination),
      );
      blocks[index] = translatePrimaryGroup(
        displaced,
        destination,
        primaryPosition(moving, index),
      );
      return { ...current, blocks };
    });
  }

  function addAlternative(primaryId: string) {
    const alternative = createBlock("A different version of this paragraph.");
    setDocument((current) => {
      const primary = getPrimary(current, primaryId);
      if (!primary) return current;
      const primaryIndex = current.blocks.findIndex(
        (block) => block.id === primaryId,
      );
      alternative.position = defaultAlternativePosition(
        primaryPosition(primary, primaryIndex),
        primary.alternatives.length,
      );
      return replacePrimary(current, primaryId, {
        ...primary,
        alternatives: [...primary.alternatives, alternative],
      });
    });
    setSelected({ primaryId, alternativeId: alternative.id });
  }

  function promoteAlternative(primaryId: string, alternativeId: string) {
    setDocument((current) => {
      const primary = getPrimary(current, primaryId);
      const promoted = primary?.alternatives.find(
        (alternative) => alternative.id === alternativeId,
      );
      if (!primary || !promoted) return current;
      const primaryIndex = current.blocks.findIndex(
        (block) => block.id === primaryId,
      );
      const alternativeIndex = primary.alternatives.findIndex(
        (alternative) => alternative.id === alternativeId,
      );
      const formerPrimary = {
        ...primary,
        position: alternativePosition(
          primary,
          primaryIndex,
          promoted,
          alternativeIndex,
        ),
        alternatives: [],
      };
      return replacePrimary(current, primaryId, {
        ...promoted,
        position: primaryPosition(primary, primaryIndex),
        alternatives: primary.alternatives.map((alternative) =>
          alternative.id === alternativeId ? formerPrimary : alternative,
        ),
      });
    });
    setSelected({ primaryId: alternativeId });
  }

  function moveAlternative(
    primaryId: string,
    alternativeId: string,
    direction: -1 | 1,
  ) {
    const primaries = document().blocks;
    const from = primaries.findIndex((block) => block.id === primaryId);
    const target = primaries[from + direction];
    const alternative = primaries[from]?.alternatives.find(
      (block) => block.id === alternativeId,
    );
    if (!target || !alternative) return;
    setDocument((current) => {
      const sourcePrimary = getPrimary(current, primaryId);
      if (!sourcePrimary) return current;
      const withoutAlternative = replacePrimary(current, primaryId, {
        ...sourcePrimary,
        alternatives: sourcePrimary.alternatives.filter(
          (block) => block.id !== alternativeId,
        ),
      });
      const targetPrimary = getPrimary(withoutAlternative, target.id);
      if (!targetPrimary) return withoutAlternative;
      return replacePrimary(withoutAlternative, target.id, {
        ...targetPrimary,
        alternatives: [...targetPrimary.alternatives, alternative],
      });
    });
    setSelected({ primaryId: target.id, alternativeId });
  }

  function updateBlockContent(
    primaryId: string,
    alternativeId: string | undefined,
    content: string,
  ) {
    updateBlock(primaryId, alternativeId, (block) => ({ ...block, content }));
  }

  function updateBlockPosition(
    primaryId: string,
    alternativeId: string | undefined,
    position: Point,
  ) {
    updateBlock(primaryId, alternativeId, (block) => ({ ...block, position }));
  }

  function updateBlockSize(
    primaryId: string,
    alternativeId: string | undefined,
    size: Size,
  ) {
    updateBlock(primaryId, alternativeId, (block) => ({ ...block, size }));
  }

  function updateBlock(
    primaryId: string,
    alternativeId: string | undefined,
    change: (block: Block) => Block,
  ) {
    setDocument((source) => {
      const primary = getPrimary(source, primaryId);
      if (!primary) return source;
      if (!alternativeId)
        return replacePrimary(source, primaryId, change(primary));
      return replacePrimary(
        source,
        primaryId,
        updateAlternative(primary, alternativeId, change),
      );
    });
  }

  function movePrimaryGroup(
    primaryId: string,
    primaryIndex: number,
    position: Point,
  ) {
    setDocument((source) => {
      const primary = getPrimary(source, primaryId);
      return primary
        ? replacePrimary(
            source,
            primary.id,
            translatePrimaryGroup(primary, primaryIndex, position),
          )
        : source;
    });
  }

  function autoLayout() {
    setDocument((current) => ({
      ...current,
      blocks: current.blocks.map((block, primaryIndex) => {
        const position = defaultPrimaryPosition(primaryIndex);
        return {
          ...block,
          position,
          alternatives: block.alternatives.map(
            (alternative, alternativeIndex) => ({
              ...alternative,
              position: defaultAlternativePosition(position, alternativeIndex),
            }),
          ),
        };
      }),
    }));
  }

  async function compileSource(source: string, reveal: boolean) {
    const request = ++compileRequest;
    setPreviewState("working");
    setPreviewError("");
    if (reveal) {
      setRightPane("preview");
      setInspectorOpen(true);
    }
    const result = await window.writer.compileTypst(source);
    if (request !== compileRequest) return;
    if (!result.ok) {
      setPreviewState("error");
      setPreviewError(result.error);
      if (reveal)
        showToast(result.error || "Could not compile preview", "error");
      return;
    }
    setPreviewUrl(`data:application/pdf;base64,${result.pdf}`);
    setPreviewState("idle");
    if (reveal) showToast("Preview compiled");
  }

  async function compilePreview() {
    await compileSource(typstSource(), true);
  }

  function setAutoCompile(enabled: boolean) {
    setAutoCompileSignal(enabled);
    window.localStorage.setItem("blocks:auto-compile", String(enabled));
  }

  async function completePrimary(primaryId: string, position: TypstPosition) {
    const range = blockRanges().find(
      (candidate) => candidate.blockId === primaryId,
    );
    if (!range || position.line < range.localStartLine) return [];
    const firstLineOffset =
      position.line === range.localStartLine ? range.localStartCharacter : 0;
    if (position.character < firstLineOffset) return [];
    return window.writer.completeTypst(
      typstSource(),
      range.startLine + position.line - range.localStartLine,
      position.character - firstLineOffset,
    );
  }

  async function exportPdf() {
    const result = await window.writer.exportPdf(typstSource());
    if (!result.ok && !result.canceled) {
      setInspectorOpen(true);
      setPreviewError(result.error);
      setPreviewState("error");
      showToast(result.error || "Could not export PDF", "error");
      return;
    }
    if (result.ok) showToast(`Exported ${fileName(result.filePath)}`);
  }

  async function exportTypst() {
    try {
      const result = await window.writer.exportTypst(typstSource());
      if (result) showToast(`Exported ${fileName(result.filePath)}`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not export Typst",
        "error",
      );
    }
  }

  return {
    document,
    filePath,
    selected,
    setSelected,
    activePrimary,
    typstSource,
    previewUrl,
    previewState,
    previewError,
    rightPane,
    setRightPane,
    inspectorOpen,
    setInspectorOpen,
    inspectorWidth,
    setInspectorWidth,
    toasts,
    languageServerStatus,
    languageServerMessage,
    typstDiagnostics,
    typstHighlights,
    diagnosticsByBlock,
    diagnosticEntries,
    highlightsByBlock,
    autoCompile,
    setAutoCompile,
    newWindow: window.writer.newWindow,
    openDocument,
    saveDocument,
    saveDocumentAs,
    addPrimary,
    movePrimary,
    addAlternative,
    promoteAlternative,
    moveAlternative,
    updateBlockContent,
    updateBlockPosition,
    updateBlockSize,
    movePrimaryGroup,
    autoLayout,
    compilePreview,
    exportPdf,
    exportTypst,
    completePrimary,
  };
}

export type WriterState = ReturnType<typeof createWriterState>;
