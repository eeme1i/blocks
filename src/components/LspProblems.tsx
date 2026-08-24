import { For, Show } from "solid-js";
import type { WriterState } from "../state/writer";

export function LspProblems(props: { writer: WriterState }) {
  return <Show when={props.writer.diagnosticEntries().length > 0}>
    <aside class="lsp-problems" aria-label="Typst problems" style={{ right: props.writer.inspectorOpen() ? `${props.writer.inspectorWidth() + 10}px` : "10px" }}>
      <div class="lsp-problems-header">
        <span>Typst problems</span>
        <strong>{props.writer.diagnosticEntries().length}</strong>
      </div>
      <div class="lsp-problems-list">
        <For each={props.writer.diagnosticEntries()}>{(entry) => (
          <button type="button" onClick={() => entry.blockId && props.writer.setSelected({ primaryId: entry.blockId })}>
            <span classList={{ warning: entry.diagnostic.severity === 2 }}>!</span>
            <div>
              <small>{entry.blockIndex >= 0 ? `Paragraph ${entry.blockIndex + 1}` : "Generated document"} · line {entry.displayLine}</small>
              <p>{entry.diagnostic.message}</p>
            </div>
          </button>
        )}</For>
      </div>
    </aside>
  </Show>;
}
