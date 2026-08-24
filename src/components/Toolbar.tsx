import type { WriterState } from "../state/writer";

export function Toolbar(props: { writer: WriterState }) {
  const fileName = () => props.writer.filePath()?.split(/[\\/]/).pop() ?? "Untitled.blocks";
  let fileMenu: HTMLDetailsElement | undefined;

  function runFileAction(action: () => void | Promise<unknown>) {
    if (fileMenu) fileMenu.open = false;
    void action();
  }

  return (
    <header class="toolbar">
      <details
        class="file-menu"
        ref={fileMenu}
        onFocusOut={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.open = false;
        }}
      >
        <summary>File</summary>
        <div class="file-menu-popover">
          <button type="button" onClick={() => runFileAction(props.writer.newWindow)}>New Window <kbd>Ctrl/⌘ ⇧ N</kbd></button>
          <span class="file-menu-separator" />
          <button type="button" onClick={() => runFileAction(props.writer.openDocument)}>Open… <kbd>Ctrl/⌘ O</kbd></button>
          <button type="button" onClick={() => runFileAction(props.writer.saveDocument)}>Save <kbd>Ctrl/⌘ S</kbd></button>
          <button type="button" onClick={() => runFileAction(props.writer.saveDocumentAs)}>Save As… <kbd>Ctrl/⌘ ⇧ S</kbd></button>
        </div>
      </details>
      <span class="file-name">{fileName()}</span>
      <div class="file-actions">
        <button type="button" class="quiet add-compact" onClick={() => props.writer.addPrimary(props.writer.activePrimary()?.id)}>+ Paragraph</button>
      </div>
      <div class="export-actions">
        <button type="button" class="quiet" onClick={() => { props.writer.setRightPane("typst"); props.writer.setInspectorOpen(true); }}>Typst</button>
        <button type="button" class="quiet" onClick={props.writer.compilePreview}>{props.writer.previewState() === "working" ? "Compiling…" : "Preview"}</button>
        <button type="button" class="quiet" onClick={props.writer.exportTypst}>.typ</button>
        <button type="button" class="primary-action" onClick={props.writer.exportPdf}>PDF</button>
      </div>
    </header>
  );
}
