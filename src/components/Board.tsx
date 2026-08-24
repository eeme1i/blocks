import { Index, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  type Point,
  type Size,
  alternativePosition,
  alternativeSize,
  primaryPosition,
  primarySize,
} from "../model/document";
import type { WriterState } from "../state/writer";
import { localTypstHighlights, TypstEditor } from "./TypstText";

type BoardView = Point & { scale: number };
type BoardDrag = { x: number; y: number; originX: number; originY: number };
type NodeDrag = BoardDrag & {
  primaryId: string;
  alternativeId?: string;
  primaryIndex: number;
};
type NodeResize = {
  primaryId: string;
  alternativeId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function Board(props: { writer: WriterState }) {
  const [view, setView] = createSignal<BoardView>({
    x: -230,
    y: 0,
    scale: 0.65,
  });
  let boardDrag: BoardDrag | undefined;
  let nodeDrag: NodeDrag | undefined;
  let nodeResize: NodeResize | undefined;
  let canvasElement: HTMLElement | undefined;

  onMount(() => {
    const canvas = canvasElement;
    if (!canvas) return;
    canvas.addEventListener("wheel", wheelBoard, { passive: false });
    onCleanup(() => canvas.removeEventListener("wheel", wheelBoard));
  });

  function beginBoardPan(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest(".node, button, textarea")) return;
    event.preventDefault();
    const position = view();
    boardDrag = {
      x: event.clientX,
      y: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function panBoard(event: PointerEvent) {
    if (!boardDrag) return;
    const drag = boardDrag;
    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }));
  }

  function endBoardPan() {
    boardDrag = undefined;
  }

  function beginNodeDrag(
    event: PointerEvent,
    primaryId: string,
    alternativeId: string | undefined,
    position: Point,
  ) {
    if ((event.target as HTMLElement).closest("textarea, button")) return;
    event.stopPropagation();
    nodeDrag = {
      primaryId,
      alternativeId,
      x: event.clientX,
      y: event.clientY,
      originX: position.x,
      originY: position.y,
      primaryIndex: props.writer
        .document()
        .blocks.findIndex((block) => block.id === primaryId),
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    props.writer.setSelected({ primaryId, alternativeId });
  }

  function dragNode(event: PointerEvent) {
    if (!nodeDrag) return;
    event.stopPropagation();
    const drag = nodeDrag;
    const position = {
      x: drag.originX + (event.clientX - drag.x) / view().scale,
      y: drag.originY + (event.clientY - drag.y) / view().scale,
    };
    if (drag.alternativeId)
      props.writer.updateBlockPosition(
        drag.primaryId,
        drag.alternativeId,
        position,
      );
    else
      props.writer.movePrimaryGroup(
        drag.primaryId,
        drag.primaryIndex,
        position,
      );
  }

  function endNodeDrag(event: PointerEvent) {
    if (!nodeDrag) return;
    event.stopPropagation();
    nodeDrag = undefined;
  }

  function beginNodeResize(
    event: PointerEvent,
    primaryId: string,
    alternativeId: string | undefined,
    size: Size,
  ) {
    event.preventDefault();
    event.stopPropagation();
    nodeResize = {
      primaryId,
      alternativeId,
      x: event.clientX,
      y: event.clientY,
      width: size.width,
      height: size.height,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function resizeNode(event: PointerEvent) {
    if (!nodeResize) return;
    event.preventDefault();
    event.stopPropagation();
    const resize = nodeResize;
    props.writer.updateBlockSize(resize.primaryId, resize.alternativeId, {
      width: Math.max(
        190,
        resize.width + (event.clientX - resize.x) / view().scale,
      ),
      height: Math.max(
        110,
        resize.height + (event.clientY - resize.y) / view().scale,
      ),
    });
  }

  function endNodeResize(event: PointerEvent) {
    if (!nodeResize) return;
    event.stopPropagation();
    nodeResize = undefined;
  }

  function zoomBoard(nextScale: number, anchor?: Point) {
    const current = view();
    const scale = Math.min(1.6, Math.max(0.35, nextScale));
    const point = anchor ?? {
      x: (canvasElement?.clientWidth ?? 800) / 2,
      y: (canvasElement?.clientHeight ?? 600) / 2,
    };
    const worldX = (point.x - current.x) / current.scale;
    const worldY = (point.y - current.y) / current.scale;
    setView({
      x: point.x - worldX * scale,
      y: point.y - worldY * scale,
      scale,
    });
  }

  function wheelBoard(event: WheelEvent) {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) {
      setView((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
      return;
    }
    const bounds = canvasElement?.getBoundingClientRect();
    const zoomDelta = Math.max(-25, Math.min(25, event.deltaY));
    zoomBoard(view().scale * Math.exp(-zoomDelta * 0.008), {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    });
  }

  function fitBoard() {
    const positions = props.writer
      .document()
      .blocks.flatMap((block, primaryIndex) => [
        { ...primaryPosition(block, primaryIndex), ...primarySize(block) },
        ...block.alternatives.map((alternative, alternativeIndex) => ({
          ...alternativePosition(
            block,
            primaryIndex,
            alternative,
            alternativeIndex,
          ),
          ...alternativeSize(alternative),
        })),
      ]);
    if (!positions.length || !canvasElement) return;
    const left = Math.min(...positions.map((position) => position.x));
    const top = Math.min(...positions.map((position) => position.y));
    const right = Math.max(
      ...positions.map((position) => position.x + position.width),
    );
    const bottom = Math.max(
      ...positions.map((position) => position.y + position.height),
    );
    const scale = Math.min(
      1,
      (canvasElement.clientWidth - 120) / (right - left),
      (canvasElement.clientHeight - 150) / (bottom - top),
    );
    setView({
      x:
        (canvasElement.clientWidth - (right - left) * scale) / 2 - left * scale,
      y:
        (canvasElement.clientHeight - (bottom - top) * scale) / 2 -
        top * scale +
        25,
      scale,
    });
  }

  function verticalConnector(
    from: Point,
    to: Point,
    fromSize: Size,
    toSize: Size,
  ) {
    const startX = from.x + fromSize.width / 2;
    const startY = from.y + fromSize.height;
    const endX = to.x + toSize.width / 2;
    const endY = to.y;
    const middleY = (startY + endY) / 2;
    return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
  }

  function alternativeConnector(
    primary: Point,
    alternative: Point,
    primaryDimensions: Size,
    alternativeDimensions: Size,
  ) {
    const isLeft = alternative.x < primary.x;
    const startX = isLeft
      ? alternative.x + alternativeDimensions.width
      : alternative.x;
    const startY = alternative.y + alternativeDimensions.height / 2;
    const endX = isLeft ? primary.x : primary.x + primaryDimensions.width;
    const endY = primary.y + primaryDimensions.height / 2;
    const middleX = (startX + endX) / 2;
    return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
  }

  return (
    <section
      class="canvas-panel"
      ref={canvasElement}
      onPointerDown={beginBoardPan}
      onPointerMove={panBoard}
      onPointerUp={endBoardPan}
      onPointerCancel={endBoardPan}
    >
      <div class="board-viewport">
        <div
          class="board-world"
          style={{
            transform: `translate(${view().x}px, ${view().y}px) scale(${view().scale})`,
          }}
        >
          <svg class="connectors" width="3200" height="5000" aria-hidden="true">
            <Index each={props.writer.document().blocks}>
              {(block, index) => {
                const position = () => primaryPosition(block(), index);
                const next = () => props.writer.document().blocks[index + 1];
                return (
                  <>
                    <Show when={next()}>
                      {(nextBlock) => (
                        <path
                          class="spine-connector"
                          d={verticalConnector(
                            position(),
                            primaryPosition(nextBlock(), index + 1),
                            primarySize(block()),
                            primarySize(nextBlock()),
                          )}
                        />
                      )}
                    </Show>
                    <Index each={block().alternatives}>
                      {(alternative, alternativeIndex) => (
                        <path
                          class="alternative-connector"
                          d={alternativeConnector(
                            position(),
                            alternativePosition(
                              block(),
                              index,
                              alternative(),
                              alternativeIndex,
                            ),
                            primarySize(block()),
                            alternativeSize(alternative()),
                          )}
                        />
                      )}
                    </Index>
                  </>
                );
              }}
            </Index>
          </svg>

          <Index each={props.writer.document().blocks}>
            {(block, index) => {
              const position = () => primaryPosition(block(), index);
              const size = () => primarySize(block());
              return (
                <>
                  {/** biome-ignore lint/a11y/useKeyWithClickEvents: <this is moving a node has to work> */}
                  <article
                    class={`node primary ${props.writer.selected().primaryId === block().id && !props.writer.selected().alternativeId ? "selected" : ""} ${props.writer.diagnosticsByBlock().has(block().id) ? "has-diagnostic" : ""}`}
                    style={{
                      left: `${position().x}px`,
                      top: `${position().y}px`,
                      width: `${size().width}px`,
                      height: `${size().height}px`,
                    }}
                    onPointerDown={(event) =>
                      beginNodeDrag(event, block().id, undefined, position())
                    }
                    onPointerMove={dragNode}
                    onPointerUp={endNodeDrag}
                    onPointerCancel={endNodeDrag}
                    onClick={() =>
                      props.writer.setSelected({ primaryId: block().id })
                    }
                  >
                    <div class="node-header">
                      <span class="node-label">Paragraph {index + 1}</span>
                      <Show
                        when={
                          props.writer.diagnosticsByBlock().get(block().id)?.[0]
                        }
                      >
                        {(diagnostic) => (
                          <span
                            class="node-diagnostic"
                            title={diagnostic().message}
                          >
                            !
                          </span>
                        )}
                      </Show>
                      <span class="drag-grip">⠿</span>
                    </div>
                    <TypstEditor
                      ariaLabel={`Paragraph ${index + 1}`}
                      value={block().content}
                      highlights={
                        props.writer.highlightsByBlock().get(block().id) ??
                        localTypstHighlights(block().content)
                      }
                      onInput={(value) =>
                        props.writer.updateBlockContent(
                          block().id,
                          undefined,
                          value,
                        )
                      }
                      complete={(position) =>
                        props.writer.completePrimary(block().id, position)
                      }
                      placeholder="Write a paragraph…"
                    />
                    <div class="node-actions">
                      <button
                        type="button"
                        title="Move paragraph up"
                        disabled={index === 0}
                        onClick={() => props.writer.movePrimary(block().id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="make-primary"
                        onClick={() => props.writer.addAlternative(block().id)}
                      >
                        + Alternate
                      </button>
                      <button
                        type="button"
                        title="Move paragraph down"
                        disabled={
                          index === props.writer.document().blocks.length - 1
                        }
                        onClick={() => props.writer.movePrimary(block().id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      class="resize-handle"
                      title="Resize paragraph"
                      aria-label="Resize paragraph"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) =>
                        beginNodeResize(event, block().id, undefined, size())
                      }
                      onPointerMove={resizeNode}
                      onPointerUp={endNodeResize}
                      onPointerCancel={endNodeResize}
                    />
                  </article>

                  <Index each={block().alternatives}>
                    {(alternative, alternativeIndex) => {
                      const point = () =>
                        alternativePosition(
                          block(),
                          index,
                          alternative(),
                          alternativeIndex,
                        );
                      const alternativeDimensions = () =>
                        alternativeSize(alternative());
                      // biome-ignore lint/a11y/useKeyWithClickEvents: this is moving a node has to work
                      return (
                        <article
                          class={`node alternative ${props.writer.selected().alternativeId === alternative().id ? "selected" : ""}`}
                          style={{
                            left: `${point().x}px`,
                            top: `${point().y}px`,
                            width: `${alternativeDimensions().width}px`,
                            height: `${alternativeDimensions().height}px`,
                          }}
                          onPointerDown={(event) =>
                            beginNodeDrag(
                              event,
                              block().id,
                              alternative().id,
                              point(),
                            )
                          }
                          onPointerMove={dragNode}
                          onPointerUp={endNodeDrag}
                          onPointerCancel={endNodeDrag}
                          onClick={() =>
                            props.writer.setSelected({
                              primaryId: block().id,
                              alternativeId: alternative().id,
                            })
                          }
                        >
                          <div class="node-header">
                            <span class="node-label">Alternate</span>
                            <span class="drag-grip">⠿</span>
                          </div>
                          <TypstEditor
                            ariaLabel="Alternate paragraph"
                            value={alternative().content}
                            highlights={localTypstHighlights(
                              alternative().content,
                            )}
                            onInput={(value) =>
                              props.writer.updateBlockContent(
                                block().id,
                                alternative().id,
                                value,
                              )
                            }
                            placeholder="Write an alternate…"
                          />
                          <div class="node-actions">
                            <button
                              type="button"
                              title="Attach to previous primary"
                              disabled={index === 0}
                              onClick={() =>
                                props.writer.moveAlternative(
                                  block().id,
                                  alternative().id,
                                  -1,
                                )
                              }
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              class="make-primary"
                              onClick={() =>
                                props.writer.promoteAlternative(
                                  block().id,
                                  alternative().id,
                                )
                              }
                            >
                              Make primary
                            </button>
                            <button
                              type="button"
                              title="Attach to next primary"
                              disabled={
                                index ===
                                props.writer.document().blocks.length - 1
                              }
                              onClick={() =>
                                props.writer.moveAlternative(
                                  block().id,
                                  alternative().id,
                                  1,
                                )
                              }
                            >
                              →
                            </button>
                          </div>
                          <button
                            type="button"
                            class="resize-handle"
                            title="Resize alternate"
                            aria-label="Resize alternate"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) =>
                              beginNodeResize(
                                event,
                                block().id,
                                alternative().id,
                                alternativeDimensions(),
                              )
                            }
                            onPointerMove={resizeNode}
                            onPointerUp={endNodeResize}
                            onPointerCancel={endNodeResize}
                          />
                        </article>
                      );
                    }}
                  </Index>
                </>
              );
            }}
          </Index>
        </div>
      </div>
      <div class="board-controls">
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBoard(view().scale - 0.1)}
        >
          −
        </button>
        <span>{Math.round(view().scale * 100)}%</span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBoard(view().scale + 0.1)}
        >
          +
        </button>
        <button type="button" onClick={fitBoard}>
          Fit
        </button>
        <button type="button" onClick={props.writer.autoLayout}>
          Auto layout
        </button>
      </div>
    </section>
  );
}
