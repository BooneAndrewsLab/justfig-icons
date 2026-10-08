/*
 * Copied from the JustFig app (src/render/svgNode.ts) at its Phase 1 state; keep the two in
 * step by hand when either changes (the plan allows a copy or a workspace
 * package; a copy keeps this repo buildable on its own).
 */
/**
 * The tiny scene graph every renderer and export shares (note 03): an
 * element with attributes in the order they were written, and children
 * that are elements or text. Serialised deterministically.
 */

export type AttrValue = string | number;

export interface SvgNode {
  readonly tag: string;
  /** Insertion order is the written order. Undefined values are skipped. */
  readonly attrs: Readonly<Record<string, AttrValue | undefined>>;
  readonly children: readonly (SvgNode | string)[];
}

export const el = (
  tag: string,
  attrs: Readonly<Record<string, AttrValue | undefined>> = {},
  children: readonly (SvgNode | string)[] = [],
): SvgNode => ({ tag, attrs, children });

/** 2 decimals, no -0 (BarelySig's sceneToSvg). */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

export const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SerializeOptions {
  /** Drop `data-*` attributes (editor bookkeeping) from exports. */
  readonly stripData?: boolean;
}

function attrText(v: AttrValue): string {
  return typeof v === 'number' ? num(v) : escapeXml(v);
}

export function nodeToSvgString(node: SvgNode | string, opts: SerializeOptions = {}): string {
  if (typeof node === 'string') return escapeXml(node);
  let out = `<${node.tag}`;
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v === undefined) continue;
    if (opts.stripData === true && k.startsWith('data-')) continue;
    out += ` ${k}="${attrText(v)}"`;
  }
  if (node.children.length === 0) return `${out}/>`;
  return `${out}>${node.children.map((c) => nodeToSvgString(c, opts)).join('')}</${node.tag}>`;
}

export function* walkNodes(node: SvgNode): Generator<SvgNode> {
  yield node;
  for (const c of node.children) if (typeof c !== 'string') yield* walkNodes(c);
}
