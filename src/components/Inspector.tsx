import { Show } from "solid-js";
import type { WriterState } from "../state/writer";
import { HighlightedTypst } from "./TypstText";

export function Inspector(props: { writer: WriterState }) {
  let resize: { x: number; width: number } | undefined;

  function beginResize(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    resize = { x: event.clientX, width: props.writer.inspectorWidth() };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function resizePane(event: PointerEvent) {
    if (!resize) return;
    event.preventDefault();
    event.stopPropagation();
    const maximum = Math.max(320, window.innerWidth * 0.8);
    props.writer.setInspectorWidth(Math.min(maximum, Math.max(280, resize.width + resize.x - event.clientX)));
  }

  function endResize(event: PointerEvent) {
    if (!resize) return;
    event.stopPropagation();
    resize = undefined;
    window.localStorage.setItem("blocks:inspector-width", String(Math.round(props.writer.inspectorWidth())));
  }

  return (
    <Show when={props.writer.inspectorOpen()}>
      <aside class="preview-panel" style={{ width: `${props.writer.inspectorWidth()}px` }}>
        <button type="button" class="inspector-resize-handle" aria-label="Resize preview pane" title="Resize preview pane" onPointerDown={beginResize} onPointerMove={resizePane} onPointerUp={endResize} onPointerCancel={endResize} />
        <div class="preview-tabs">
          <button type="button" classList={{ active: props.writer.rightPane() === "preview" }} onClick={() => props.writer.setRightPane("preview")}>Preview</button>
          <button type="button" classList={{ active: props.writer.rightPane() === "typst" }} onClick={() => props.writer.setRightPane("typst")}>Typst</button>
          <button type="button" class="compile-button" disabled={props.writer.previewState() === "working"} onClick={props.writer.compilePreview}>{props.writer.previewState() === "working" ? "…" : "Compile"}</button>
          <label class="auto-compile" title="Compile the preview after changes"><input type="checkbox" checked={props.writer.autoCompile()} onChange={(event) => props.writer.setAutoCompile(event.currentTarget.checked)} /> Auto</label>
          <button type="button" class="close-inspector" title="Close" onClick={() => props.writer.setInspectorOpen(false)}>×</button>
        </div>
        <Show when={props.writer.rightPane() === "typst"}>
          <div class="typst-pane">
            <div class={`language-server-status ${props.writer.languageServerStatus()}`} title={props.writer.languageServerMessage()}>
              <span />
              {props.writer.languageServerStatus() === "ready" ? "Tinymist" : props.writer.languageServerStatus() === "starting" ? "Starting Tinymist…" : "Tinymist unavailable"}
              <Show when={props.writer.typstDiagnostics().length}><strong>{props.writer.typstDiagnostics().length}</strong></Show>
            </div>
            <pre class="typst-source typst-highlight"><code><HighlightedTypst source={props.writer.typstSource()} highlights={props.writer.typstHighlights()} /></code></pre>
            <Show when={props.writer.typstDiagnostics().length > 0}>
              <div class="diagnostics-list">
                {props.writer.typstDiagnostics().map((diagnostic) => (
                  <div class="diagnostic-item"><span>Line {diagnostic.range.start.line + 1}</span>{diagnostic.message}</div>
                ))}
              </div>
            </Show>
          </div>
        </Show>
        <Show when={props.writer.rightPane() === "preview"}>
          <div class="pdf-preview">
            <Show when={props.writer.previewUrl()} fallback={<div class="preview-empty"><span>Typst preview</span><p>Compile the active spine to see the final pages here.</p><button type="button" onClick={props.writer.compilePreview}>Compile</button></div>}>
              <iframe title="Compiled Typst preview" src={props.writer.previewUrl() ?? undefined} />
            </Show>
            <Show when={props.writer.previewState() === "error"}><div class="compile-error">{props.writer.previewError()}</div></Show>
          </div>
        </Show>
      </aside>
    </Show>
  );
}
