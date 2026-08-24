import { For, Show, createSignal, onCleanup } from "solid-js";

type HighlightSegment = { text: string; type?: string };

function highlightedLines(source: string, highlights: TypstHighlight[]) {
  const tokensByLine = new Map<number, TypstHighlight[]>();
  for (const token of highlights) {
    tokensByLine.set(token.line, [...(tokensByLine.get(token.line) ?? []), token]);
  }

  return source.split("\n").map((line, lineNumber) => {
    const segments: HighlightSegment[] = [];
    let cursor = 0;
    const tokens = (tokensByLine.get(lineNumber) ?? []).sort((left, right) => left.start - right.start);
    for (const token of tokens) {
      const start = Math.max(cursor, Math.min(line.length, token.start));
      const end = Math.max(start, Math.min(line.length, token.start + token.length));
      if (start > cursor) segments.push({ text: line.slice(cursor, start) });
      if (end > start) segments.push({ text: line.slice(start, end), type: token.type });
      cursor = end;
    }
    if (cursor < line.length) segments.push({ text: line.slice(cursor) });
    return segments;
  });
}

export function localTypstHighlights(source: string) {
  const highlights: TypstHighlight[] = [];
  const pattern = /(\/\/.*$)|("(?:\\.|[^"\\])*")|(https?:\/\/\S+)|(^\s*=+(?=\s))|(#(?:set|show|let|if|else|for|while|import|include|return|context)\b)|(#?[A-Za-z_][\w-]*(?=\s*\())|(\b\d+(?:\.\d+)?(?:pt|em|in|cm|mm|%)?\b)|([#*_`$[\]])/g;
  source.split("\n").forEach((line, lineNumber) => {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      const type = match[1] ? "comment"
        : match[2] ? "string"
        : match[3] ? "link"
        : match[4] ? "heading"
        : match[5] ? "keyword"
        : match[6] ? "function"
        : match[7] ? "number"
        : "delim";
      highlights.push({ line: lineNumber, start: match.index, length: match[0].length, type });
    }
  });
  return highlights;
}

export function HighlightedTypst(props: { source: string; highlights: TypstHighlight[] }) {
  return <For each={highlightedLines(props.source, props.highlights)}>{(line, lineNumber) => <><For each={line}>{(segment) => <Show when={segment.type} fallback={segment.text}>{(type) => <span class={`token-${type().replace(/[^a-zA-Z0-9_-]/g, "-")}`}>{segment.text}</span>}</Show>}</For><Show when={lineNumber() < props.source.split("\n").length - 1}>{"\n"}</Show></>}</For>;
}

export function TypstEditor(props: {
  value: string;
  highlights: TypstHighlight[];
  ariaLabel: string;
  placeholder: string;
  onInput(value: string): void;
  complete?(position: TypstPosition): Promise<TypstCompletion[]>;
}) {
  let highlightedElement: HTMLPreElement | undefined;
  let textareaElement: HTMLTextAreaElement | undefined;
  let completionTimer: number | undefined;
  let completionRequest = 0;
  const [completions, setCompletions] = createSignal<TypstCompletion[]>([]);
  const [activeCompletion, setActiveCompletion] = createSignal(0);
  const [menuPosition, setMenuPosition] = createSignal({ left: 0, top: 0 });

  const fallbackCompletions: TypstCompletion[] = [
    "#set", "#show", "#let", "#text", "#strong", "#emph", "#link",
    "#heading", "#figure", "#image", "#table", "#grid", "#align", "#pagebreak",
  ].map((label) => ({ label, insertText: label, detail: "Typst" }));

  onCleanup(() => window.clearTimeout(completionTimer));

  function synchronizeScroll(event: Event) {
    if (!highlightedElement) return;
    const textarea = event.currentTarget as HTMLTextAreaElement;
    highlightedElement.scrollTop = textarea.scrollTop;
    highlightedElement.scrollLeft = textarea.scrollLeft;
  }

  function wordRange(value: string, cursor: number) {
    let start = cursor;
    while (start > 0 && /[A-Za-z0-9_#-]/.test(value[start - 1])) start -= 1;
    return { start, end: cursor, prefix: value.slice(start, cursor) };
  }

  function positionAt(value: string, offset: number): TypstPosition {
    const before = value.slice(0, offset);
    const lines = before.split("\n");
    return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
  }

  function locateMenu(textarea: HTMLTextAreaElement) {
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "fixed", visibility: "hidden", boxSizing: "border-box",
      width: `${textarea.clientWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word",
      font: computed.font, lineHeight: computed.lineHeight, padding: computed.padding,
      border: computed.border,
    });
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.append(marker);
    document.body.append(mirror);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 16;
    setMenuPosition({
      left: Math.max(0, Math.min(textarea.clientWidth - 190, marker.offsetLeft - textarea.scrollLeft)),
      top: Math.max(18, marker.offsetTop + lineHeight - textarea.scrollTop),
    });
    mirror.remove();
  }

  function requestCompletions(textarea: HTMLTextAreaElement) {
    window.clearTimeout(completionTimer);
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const { prefix } = wordRange(value, cursor);
    const request = ++completionRequest;
    completionTimer = window.setTimeout(async () => {
      let items = props.complete ? await props.complete(positionAt(value, cursor)) : [];
      const query = prefix.replace(/^#/, "").toLowerCase();
      if (query) {
        items = items
          .filter((item) => item.label.toLowerCase().includes(query) || item.insertText.toLowerCase().includes(query))
          .sort((left, right) => {
            const leftStarts = left.label.toLowerCase().startsWith(query) || left.insertText.toLowerCase().startsWith(query);
            const rightStarts = right.label.toLowerCase().startsWith(query) || right.insertText.toLowerCase().startsWith(query);
            return Number(rightStarts) - Number(leftStarts);
          });
      }
      if (items.length === 0 && prefix.startsWith("#")) {
        const normalized = prefix.toLowerCase();
        items = fallbackCompletions.filter((item) => item.label.startsWith(normalized));
      }
      if (request !== completionRequest || textarea.value !== value || textarea.selectionStart !== cursor) return;
      const seen = new Set<string>();
      setCompletions(items.filter((item) => !seen.has(item.label) && seen.add(item.label)).slice(0, 8));
      setActiveCompletion(0);
      locateMenu(textarea);
    }, 90);
  }

  function acceptCompletion(item: TypstCompletion) {
    const textarea = textareaElement;
    if (!textarea) return;
    const range = wordRange(textarea.value, textarea.selectionStart);
    const start = range.prefix.startsWith("#") && !item.insertText.startsWith("#") ? range.start + 1 : range.start;
    const next = textarea.value.slice(0, start) + item.insertText + textarea.value.slice(range.end);
    const cursor = start + item.insertText.length;
    textarea.value = next;
    props.onInput(next);
    setCompletions([]);
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function handleKeyDown(event: KeyboardEvent) {
    const items = completions();
    if (!items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveCompletion((current) => (current + direction + items.length) % items.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptCompletion(items[activeCompletion()]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCompletions([]);
    }
  }

  return <div class="typst-editor">
    <pre ref={highlightedElement} class="node-highlight typst-highlight" aria-hidden="true"><HighlightedTypst source={props.value} highlights={props.highlights} /></pre>
    <textarea
      ref={textareaElement}
      class="syntax-input"
      aria-label={props.ariaLabel}
      value={props.value}
      placeholder={props.placeholder}
      spellcheck={false}
      onClick={(event) => event.stopPropagation()}
      onInput={(event) => { props.onInput(event.currentTarget.value); requestCompletions(event.currentTarget); }}
      onScroll={synchronizeScroll}
      onKeyDown={handleKeyDown}
      onBlur={() => window.setTimeout(() => setCompletions([]), 100)}
    />
    <Show when={completions().length > 0}>
      <div class="autocomplete-menu" style={{ left: `${menuPosition().left}px`, top: `${menuPosition().top}px` }}>
        <For each={completions()}>{(item, index) => <button type="button" classList={{ active: index() === activeCompletion() }} onPointerDown={(event) => { event.preventDefault(); acceptCompletion(item); }}>
          <span>{item.label}</span><small>{item.detail}</small>
        </button>}</For>
      </div>
    </Show>
  </div>;
}
