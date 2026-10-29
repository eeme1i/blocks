import { For, Show } from "solid-js";
import {
  type ImageSettings,
  type ImageParameter,
  imageParameterValue,
  figureParameterNames,
} from "../model/document";

const hints: Record<ImageParameter, string> = {
  width: "auto, 100%, 8cm",
  height: "auto, 4cm, 1fr",
  alt: 'none or "Description"',
  format: 'auto, "png", (encoding: "rgb8", width: 1, height: 1)',
  page: "1 (PDF page)",
  fit: '"cover", "contain", "stretch"',
  scaling: 'auto, "smooth", "pixelated"',
  icc: 'auto, "assets/profile.icc", bytes(...)',
};
const figureDefaults = {
  placement: "none",
  scope: '"column"',
  kind: "auto",
  supplement: "auto",
  numbering: '"1"',
  gap: "0.65em",
  outlined: "true",
};

export function ImageBlock(props: {
  image: ImageSettings;
  assets: Record<string, ImageAsset>;
  onChange(change: Partial<ImageSettings>): void;
}) {
  const parameter = (name: ImageParameter) => (
    <label class="image-parameter">
      <span>{name}</span>
      <input
        aria-label={`Image ${name}`}
        spellcheck={false}
        title={hints[name]}
        placeholder={hints[name]}
        value={imageParameterValue(props.image, name)}
        onInput={(event) =>
          props.onChange({
            parameters: {
              ...props.image.parameters,
              [name]: event.currentTarget.value,
            },
          })
        }
      />
    </label>
  );
  const figure = () => props.image.figure ?? !!props.image.caption.trim();
  return (
    <div
      class="image-block-editor"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
      }}
    >
      <img
        class="image-block-preview"
        draggable={false}
        src={props.assets[props.image.assetId]?.url}
        alt={props.image.alt || "Imported image"}
      />
      <div class="image-block-fields">
        <div class="image-dimensions">
          {parameter("width")}
          {parameter("height")}
        </div>
        {parameter("alt")}
        <details class="image-advanced">
          <summary>Image parameters</summary>
          <p class="image-parameter-help">
            Typst expressions; quote strings. Blank restores the default.
            Preview shows the compiled result.
          </p>
          <label class="image-parameter">
            <span>source</span>
            <textarea
              aria-label="Image source"
              spellcheck={false}
              value={props.image.source ?? ""}
              placeholder={JSON.stringify(`assets/${props.image.assetId}`)}
              onInput={(event) =>
                props.onChange({ source: event.currentTarget.value })
              }
            />
          </label>
          <For
            each={
              ["format", "page", "fit", "scaling", "icc"] as ImageParameter[]
            }
          >
            {parameter}
          </For>
        </details>
        <label class="image-figure-toggle">
          <input
            type="checkbox"
            checked={figure()}
            onChange={(event) =>
              props.onChange({ figure: event.currentTarget.checked })
            }
          />{" "}
          Wrap in figure
        </label>
        <Show when={figure()}>
          <label class="image-parameter">
            <span>caption</span>
            <textarea
              aria-label="Figure caption"
              value={props.image.caption}
              placeholder="Figure caption…"
              onInput={(event) =>
                props.onChange({ caption: event.currentTarget.value })
              }
            />
          </label>
          <label class="image-parameter">
            <span>label</span>
            <input
              aria-label="Figure label"
              value={props.image.label ?? ""}
              placeholder="e.g. overview (reference with @overview)"
              onInput={(event) =>
                props.onChange({ label: event.currentTarget.value })
              }
            />
          </label>
          <details class="image-advanced">
            <summary>Figure parameters</summary>
            <For each={figureParameterNames}>
              {(name) => (
                <label class="image-parameter">
                  <span>{name}</span>
                  <input
                    aria-label={`Figure ${name}`}
                    spellcheck={false}
                    placeholder={figureDefaults[name]}
                    value={props.image.figureParameters?.[name] ?? ""}
                    onInput={(event) =>
                      props.onChange({
                        figureParameters: {
                          ...props.image.figureParameters,
                          [name]: event.currentTarget.value,
                        },
                      })
                    }
                  />
                </label>
              )}
            </For>
          </details>
        </Show>
      </div>
    </div>
  );
}
