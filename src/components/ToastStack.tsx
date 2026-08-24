import { Index } from "solid-js";
import type { WriterState } from "../state/writer";

export function ToastStack(props: { writer: WriterState }) {
  return (
    <div class="toast-region" aria-live="polite" aria-atomic="true">
      <Index each={props.writer.toasts()}>
        {(toast) => (
          <div class={`toast ${toast().tone}`}>
            <span class="toast-icon">
              {toast().tone === "success" ? "✓" : "!"}
            </span>
            <span>{toast().message}</span>
          </div>
        )}
      </Index>
    </div>
  );
}
