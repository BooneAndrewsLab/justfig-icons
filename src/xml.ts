/*
 * Copied from the JustFig app (src/render/xml.ts) at its Phase 1 state; keep the two in
 * step by hand when either changes (the plan allows a copy or a workspace
 * package; a copy keeps this repo buildable on its own).
 */
/**
 * A small, strict-enough XML parser for SVG text, into `SvgNode`s. Pure, so
 * icons and imported SVGs render the same in Node (golden tests), the
 * browser and any worker. Skips the prolog, doctype, comments and
 * processing instructions; keeps CDATA as text (for <style>).
 */
import { type SvgNode, el } from './svgNode.ts';

export class XmlError extends Error {
  override readonly name = 'XmlError';
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

interface Building {
  tag: string;
  attrs: Record<string, string>;
  children: (SvgNode | string)[];
}

export function parseXml(text: string): SvgNode {
  const stack: Building[] = [];
  const out: { root: SvgNode | null } = { root: null };
  let i = 0;
  const n = text.length;
  const close = (b: Building): void => {
    const node = el(b.tag, b.attrs, b.children);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else out.root ??= node;
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) {
      const t = decodeEntities(text.slice(i, lt));
      const parent = stack[stack.length - 1];
      if (parent && t.trim() !== '') parent.children.push(t);
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('unclosed comment');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      if (end === -1) throw new XmlError('unclosed CDATA');
      stack[stack.length - 1]?.children.push(text.slice(lt + 9, end));
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt);
      if (end === -1) throw new XmlError('unclosed processing instruction');
      i = end + 2;
    } else if (text.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [ ].
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j += 1) {
        const c = text[j];
        if (c === '[') depth += 1;
        else if (c === ']') depth -= 1;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      if (end === -1) throw new XmlError('unclosed end tag');
      const name = text.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (top?.tag !== name) throw new XmlError(`mismatched </${name}>`);
      close(top);
      i = end + 1;
    } else {
      const m = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(lt, lt + 200));
      if (!m?.[1]) throw new XmlError('bad tag');
      const tag = m[1];
      let j = lt + m[0].length;
      const attrs: Record<string, string> = {};
      const attrRe = /\s*([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      let end: string | undefined;
      while (end === undefined) {
        attrRe.lastIndex = j;
        const a = attrRe.exec(text);
        if (!a) throw new XmlError(`bad attributes in <${tag}>`);
        j = attrRe.lastIndex;
        end = a[5];
        if (a[1] !== undefined) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
      }
      const selfClosing = end === '/>';
      const b: Building = { tag, attrs, children: [] };
      if (selfClosing) close(b);
      else stack.push(b);
      i = j;
    }
    if (out.root && stack.length === 0) break;
  }
  if (!out.root) throw new XmlError('no root element');
  return out.root;
}
