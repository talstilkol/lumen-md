/**
 * The entity infobox card (plan W13.G6): name, type, picture, the type's
 * fields and the five key relations, as a table with row headers — what a
 * screen reader reads as "Born in, Haifa". Names of entities are wiki links,
 * so a click opens the entity and pointing at one shows its own card.
 * Presentational: ./EntityInfoboxBlock.tsx loads the data.
 */
import { useEffect, useId, useState } from "react";
import { getLocale, t } from "../../i18n";
import { formatInfoValue, type InfoboxModel, type InfoValue } from "../../entities/infobox";
import "./entityInfobox.css";
import { HelpButton } from "../HelpButton";

export interface EntityInfoboxProps {
  model: InfoboxModel;
  /** A displayable URL for the picture's vault path (an object URL); undefined while loading or when missing. */
  resolveImage?: (path: string) => Promise<string | undefined>;
  /** The wiki-link target for an entity id (its note), so names are links. */
  linkOf?: (id: string) => string | undefined;
  /** The hover card: no float, full width. */
  hover?: boolean;
  dir?: "rtl" | "ltr";
}

function Value({ v, linkOf }: { v: InfoValue; linkOf?: EntityInfoboxProps["linkOf"] }) {
  const target = v.id ? linkOf?.(v.id) : undefined;
  if (target)
    return (
      <a className="wiki-link" data-wiki-target={target} href={`#${encodeURIComponent(target)}`} dir="auto">
        {v.text}
      </a>
    );
  // Dates and numbers the reader's way (audit r4 A3 #10); the machine-readable date stays in <time>.
  const f = formatInfoValue(v, getLocale() || "en");
  return f.iso ? (
    <time dateTime={f.iso} dir="auto">
      {f.text}
    </time>
  ) : (
    <span dir="auto">{f.text}</span>
  );
}

/** The other entity's role, read from this entity: the forward name, or the relation's own inverse name ("parent", "born here"). */
function roleOf(predicate: string, outgoing: boolean): string {
  const forward = t(`entityGraph.predicate.${predicate}`);
  if (outgoing) return forward;
  const key = `entityGraph.inverse.${predicate}`;
  const named = t(key);
  return named !== key ? named : t("entityGraph.infobox.inverse", { relation: forward });
}

export function EntityInfobox({ model, resolveImage, linkOf, hover, dir }: EntityInfoboxProps) {
  const id = useId();
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    let off = false;
    setSrc(undefined);
    if (model.image && resolveImage) void resolveImage(model.image).then((u) => !off && setSrc(u));
    return () => {
      off = true;
    };
  }, [model.image, resolveImage]);
  const e = model.entity;
  return (
    <aside className={`lumen-infobox${hover ? " is-hover" : ""}`} dir={dir} aria-labelledby={`${id}-name`} data-testid="entity-infobox" data-entity={e.id}>
      <table>
        <caption id={`${id}-name`} dir="auto">
          {e.name}
        </caption>
        <tbody>
          <tr>
            <td colSpan={2} className="lumen-infobox-type" style={{ borderBlockStart: 0 }}>
              <span style={{ float: "inline-end", marginInlineStart: 6 }}><HelpButton topic="workspace/entity-graph" size={18} /></span>
              {t(`entityGraph.type.${e.type}`)}
              {e.aliases.length > 0 && (
                <>
                  {" · "}
                  <span dir="auto">{e.aliases.slice(0, 3).join(", ")}</span>
                </>
              )}
            </td>
          </tr>
          {model.image && src && (
            <tr>
              <td colSpan={2} style={{ padding: 0, borderBlockStart: 0 }}>
                <figure>
                  <img src={src} alt={t("entityGraph.infobox.picture", { name: e.name })} loading="lazy" />
                </figure>
              </td>
            </tr>
          )}
          {model.rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{t(r.label)}</th>
              <td>
                {r.values.length === 1 ? (
                  <Value v={r.values[0]} linkOf={linkOf} />
                ) : (
                  <ul>
                    {r.values.map((v) => (
                      <li key={v.id ?? v.text}>
                        <Value v={v} linkOf={linkOf} />
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
          {model.key.length > 0 && (
            <>
              <tr>
                <th scope="colgroup" colSpan={2} className="lumen-infobox-section">
                  {t("entityGraph.infobox.key")}
                </th>
              </tr>
              <tr>
                <td colSpan={2}>
                  <ul className="lumen-infobox-key">
                    {model.key.map((k) => (
                      <li key={k.other}>
                        <Value v={{ text: model.names.get(k.other) ?? k.other, id: k.other }} linkOf={linkOf} />{" "}
                        <span className="lumen-infobox-rel">
                          {roleOf(k.edge.predicate, k.outgoing)}
                          {k.count > 1 && ` · ${t("entityGraph.infobox.times", { n: formatInfoValue({ text: String(k.count), kind: "number" }, getLocale() || "en").text })}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            </>
          )}
          {!model.rows.length && !model.key.length && (
            <tr>
              {/* empty-allow: a row of the infobox card ("no facts yet"), inside a card that has its own actions */}
              <td colSpan={2} className="lumen-infobox-rel">
                {t("entityGraph.infobox.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {/* i18n-allow: "Wikidata" is the source's name, the same in every language */}
      {e.qid && <div className="lumen-infobox-foot">Wikidata {e.qid}</div>}
    </aside>
  );
}
