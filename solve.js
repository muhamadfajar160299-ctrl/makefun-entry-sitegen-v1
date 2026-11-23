// Fast reimplementation of makefun-site 1.0.0, written from its behaviour
// specification (the prose README in the kit) and the practice data only.
// run(input) returns the output tree for one case, byte-identical to the
// reference for the same input.
//
// Design notes:
// - Single-pass Markdown renderer with minimal allocation.
// - Templates are parsed once per case into a small instruction list and
//   interpreted; loops reuse one loop object, strings are built with
//   push/join.
// - Slugs are memoised per run (pure function, cache cleared per case).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- helpers

const ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCRE = /[&<>"']/g;
const ESC_TEST_RE = /[&<>"']/;
function escRepl(m) { return ESCMAP[m]; }

function pushEsc(out, s, a, b) {
  if (a >= b) return;
  const seg = s.slice(a, b);
  if (!ESC_TEST_RE.test(seg)) { out.push(seg); return; }
  out.push(seg.replace(ESCRE, escRepl));
}

const ESC_TEST = /[&<>"']/;

function escStr(s) {
  if (!ESC_TEST.test(s)) return s;
  const out = [];
  pushEsc(out, s, 0, s.length);
  return out.join('');
}

const COMBINING = /\p{M}/gu;

function slugifyRaw(text) {
  const n = text.normalize('NFKD').replace(COMBINING, '');
  let out = '';
  let lastDash = true;
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c >= 97 && c <= 122) { out += n[i]; lastDash = false; }
    else if (c >= 65 && c <= 90) { out += String.fromCharCode(c + 32); lastDash = false; }
    else if (c >= 48 && c <= 57) { out += n[i]; lastDash = false; }
    else if (!lastDash) { out += '-'; lastDash = true; }
  }
  if (lastDash && out.length > 0) out = out.slice(0, -1);
  if (out.length > 64) {
    out = out.slice(0, 64);
    if (out.charCodeAt(out.length - 1) === 45) out = out.slice(0, -1);
  }
  return out === '' ? 'untitled' : out;
}

// Per-run memo for slugify (cleared at the start of run()).
let SLUG_CACHE = null;
function slugify(text) {
  let r = SLUG_CACHE.get(text);
  if (r === undefined) {
    r = slugifyRaw(text);
    SLUG_CACHE.set(text, r);
  }
  return r;
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) { taken.add(base); return base; }
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  const s = base + '-' + n;
  taken.add(s);
  return s;
}

function dateLong(d) {
  if (!d) return '';
  return (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
}

function validDate(v) {
  if (v.length !== 10 || v.charCodeAt(4) !== 45 || v.charCodeAt(7) !== 45) return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
  if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = m === 2 ? (leap ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);
  return d <= dim;
}

function truthy(v) {
  return !(v === undefined || v === null || v === false || v === '' || v === 0 ||
    (Array.isArray(v) && v.length === 0));
}

function writeValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) {
      if (i) s += ', ';
      s += writeValue(v[i]);
    }
    return s;
  }
  return '';
}

const hasOwn = Object.prototype.hasOwnProperty;

function resolvePath(root, frames, segs) {
  let v;
  const first = segs[0];
  let found = false;
  for (let i = frames.length - 1; i >= 0; i--) {
    const fr = frames[i];
    if (first === 'loop') { v = fr[2]; found = true; break; }
    if (first === fr[0]) { v = fr[1]; found = true; break; }
  }
  if (!found) v = hasOwn.call(root, first) ? root[first] : undefined;
  for (let i = 1; i < segs.length; i++) {
    if (v === null || v === undefined) return undefined;
    if ((typeof v === 'object' || typeof v === 'function') && hasOwn.call(v, segs[i])) {
      v = v[segs[i]];
    } else {
      return undefined;
    }
  }
  return v;
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimST(s) {
  let a = 0, b = s.length;
  while (a < b) {
    const c = s.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = s.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return s.slice(a, b);
}

function isSpaceTab(c) { return c === 32 || c === 9; }

function isWhitespaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 ||
    c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 ||
    c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

function countWords(lines) {
  let words = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let inWord = false;
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      const ws = c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 5760 ||
        (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 ||
        c === 8287 || c === 12288 || c === 65279;
      if (ws) inWord = false;
      else if (!inWord) { words++; inWord = true; }
    }
  }
  return words;
}

// ------------------------------------------------------------ front matter

const KNOWN_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LAYOUT_RE = /^[a-z0-9-]+$/;
const KEY_LINE_RE = /^([a-z_]+):(.*)$/;

function parseQuoted(val) {
  // val[0] === '"'. Returns { v: string } or { e: reason }.
  let out = '';
  for (let i = 1; i < val.length; i++) {
    const c = val[i];
    if (c === '\\') {
      if (i + 1 >= val.length) return { e: 'a quoted string is not closed' };
      const nx = val[i + 1];
      if (nx === '"' || nx === '\\') { out += nx; i++; }
      else return { e: 'a quoted string has a bad escape' };
    } else if (c === '"') {
      if (i !== val.length - 1) return { e: 'a quoted string is not closed' };
      return { v: out };
    } else {
      out += c;
    }
  }
  return { e: 'a quoted string is not closed' };
}

// Parses front matter from the file's lines. Returns { fm, bodyStart } or
// { error }.
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const fm = {};
  const seen = new Set();
  for (let li = 1; li < close; li++) {
    const line = lines[li];
    if (isBlankLine(line)) continue;
    if (line.charCodeAt(0) === 35) continue; // comment opening on '#'
    const m = KEY_LINE_RE.exec(line);
    if (!m) return { error: 'line ' + (li + 1) + ' is not "key: value"' };
    const key = m[1];
    if (!KNOWN_KEYS.has(key)) return { error: 'unknown key "' + key + '"' };
    if (seen.has(key)) return { error: 'key "' + key + '" is given twice' };
    seen.add(key);
    let val = m[2];
    if (val.charCodeAt(0) === 32) val = val.slice(1);
    val = val.replace(/[ \t]+$/, '');
    if (val === '') return { error: 'key "' + key + '" has no value' };
    if (key === 'title' || key === 'summary') {
      if (val.charCodeAt(0) === 34) {
        const q = parseQuoted(val);
        if (q.e !== undefined) return { error: 'key "' + key + '": ' + q.e };
        fm[key] = q.v;
      } else if (val.charCodeAt(0) === 91) {
        return { error: 'key "' + key + '": a bare string opens on [' };
      } else {
        fm[key] = val;
      }
    } else if (key === 'date') {
      if (!validDate(val)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      fm.date = val;
    } else if (key === 'tags') {
      if (val.charCodeAt(0) !== 91 || val.charCodeAt(val.length - 1) !== 93) {
        return { error: 'key "tags": not a list [a, b]' };
      }
      const inner = val.slice(1, -1);
      if (inner === '') {
        fm.tags = [];
      } else {
        const parts = inner.split(',');
        const tags = new Array(parts.length);
        for (let i = 0; i < parts.length; i++) {
          const t = trimST(parts[i]);
          if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
            return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
          }
          tags[i] = t;
        }
        fm.tags = tags;
      }
    } else if (key === 'draft') {
      if (val === 'true') fm.draft = true;
      else if (val === 'false') fm.draft = false;
      else return { error: 'key "draft": true or false' };
    } else if (key === 'layout') {
      if (!LAYOUT_RE.test(val)) return { error: 'key "layout": not a template name' };
      fm.layout = val;
    } else if (key === 'slug') {
      if (val.length > 64 || !SLUG_RE.test(val)) return { error: 'key "slug": not a slug' };
      fm.slug = val;
    }
  }
  if (!fm.title) return { error: 'no title' };
  return { fm, bodyStart: close + 1 };
}

// --------------------------------------------------------------- templates
//
// Node kinds (arrays):
//   [0, text]                       literal text
//   [1, segs, raw]                  {{ path }} / {{{ path }}}
//   [2, varName, segs, body]        {% for x in path %}...{% endfor %}
//   [3, segs, neg, then, elseBody]  {% if [not] path %}...{% else %}...{% endif %}
//   [4, name]                       {% include "name" %}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parsePath(s) {
  if (!PATH_RE.test(s)) return null;
  return s.split('.');
}

function allSpacesTabs(s, a, b) {
  for (let i = a; i < b; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function parseTemplate(src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let cur = root;
  let pos = 0;
  let textStart = 0;
  const n = src.length;

  function pushText(a, b) {
    if (b > a) cur.body.push([0, src.slice(a, b)]);
  }

  while (pos < n) {
    const o = src.indexOf('{', pos);
    if (o === -1) break;
    const c1 = src.charCodeAt(o + 1);
    if (c1 === 123) { // '{{' or '{{{'
      const raw = src.charCodeAt(o + 2) === 123;
      const closeMarker = raw ? '}}}' : '}}';
      const close = src.indexOf(closeMarker, o + (raw ? 3 : 2));
      if (close === -1) return { error: raw ? '{{{ is not closed' : '{{ is not closed' };
      pushText(textStart, o);
      const inner = src.slice(o + (raw ? 3 : 2), close).trim();
      const segs = parsePath(inner);
      if (!segs) return { error: 'not a path' };
      cur.body.push([1, segs, raw]);
      pos = close + closeMarker.length;
      textStart = pos;
    } else if (c1 === 37) { // '{%'
      const close = src.indexOf('%}', o + 2);
      if (close === -1) return { error: '{% is not closed' };
      // Standalone line? Only spaces/tabs beside the tag on its line.
      const lineStart = src.lastIndexOf('\n', o - 1) + 1;
      const nl = src.indexOf('\n', close + 2);
      const afterEnd = nl === -1 ? n : nl;
      const standalone = lineStart >= textStart &&
        allSpacesTabs(src, lineStart, o) && allSpacesTabs(src, close + 2, afterEnd);
      if (standalone) {
        pushText(textStart, lineStart);
        pos = nl === -1 ? n : nl + 1;
        textStart = pos;
        // The tag itself still needs processing, but its line is dropped.
        // Fall through to tag handling with the tag span [o, close).
        const err = handleTag(src.slice(o + 2, close).trim());
        if (err) return { error: err };
        // cur may have changed (for/if push/pop) - recompute below.
        cur = stack[stack.length - 1];
        continue;
      }
      pushText(textStart, o);
      const err = handleTag(src.slice(o + 2, close).trim());
      if (err) return { error: err };
      cur = stack[stack.length - 1];
      pos = close + 2;
      textStart = pos;
    } else {
      pos = o + 1;
    }
  }
  pushText(textStart, n);
  if (stack.length > 1) {
    const top = stack[stack.length - 1];
    return { error: top.kind === 'for' ? '{% for %} is not closed' : '{% if %} is not closed' };
  }
  return { nodes: root.body };

  function handleTag(inner) {
    if (inner === 'endfor') {
      if (cur.kind !== 'for') return '{% endfor %} without {% for %}';
      stack.pop();
      return null;
    }
    if (inner === 'endif') {
      if (cur.kind !== 'if') return '{% endif %} without {% if %}';
      stack.pop();
      return null;
    }
    if (inner === 'else') {
      if (cur.kind !== 'if' || cur.node[4] !== null) return '{% else %} without {% if %}';
      cur.node[4] = [];
      cur.body = cur.node[4];
      return null;
    }
    if (inner.startsWith('for ') || inner === 'for') {
      const m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(\S+)$/.exec(inner);
      if (!m) return 'unknown tag';
      const segs = parsePath(m[2]);
      if (!segs) return 'not a path';
      const node = [2, m[1], segs, []];
      cur.body.push(node);
      const frame = { kind: 'for', body: node[3] };
      stack.push(frame);
      return null;
    }
    if (inner.startsWith('if ') || inner === 'if') {
      const m = /^if\s+(not\s+)?(\S+)$/.exec(inner);
      if (!m) return 'unknown tag';
      const segs = parsePath(m[2]);
      if (!segs) return 'not a path';
      const node = [3, segs, !!m[1], [], null];
      cur.body.push(node);
      const frame = { kind: 'if', body: node[3], elseBody: null, node };
      stack.push(frame);
      return null;
    }
    if (inner.startsWith('include ') || inner === 'include') {
      const m = /^include\s+"([^"]*)"$/.exec(inner);
      if (!m) return 'unknown tag';
      cur.body.push([4, m[1]]);
      return null;
    }
    return 'unknown tag';
  }
}

// Per-run template table (name -> nodes), set by run().
let TEMPLATES = null;

function renderNodes(nodes, root, frames, depth, out) {
  for (let k = 0; k < nodes.length; k++) {
    const nd = nodes[k];
    switch (nd[0]) {
      case 0:
        out.push(nd[1]);
        break;
      case 1: {
        const v = resolvePath(root, frames, nd[1]);
        const s = writeValue(v);
        if (nd[2]) out.push(s);
        else if (s !== '') out.push(escStr(s));
        break;
      }
      case 2: {
        const arr = resolvePath(root, frames, nd[2]);
        if (Array.isArray(arr)) {
          const len = arr.length;
          if (len > 0) {
            const loop = { index: 0, first: false, last: false, length: len };
            const frame = [nd[1], arr[0], loop];
            frames.push(frame);
            for (let i = 0; i < len; i++) {
              loop.index = i + 1;
              loop.first = i === 0;
              loop.last = i === len - 1;
              frame[1] = arr[i];
              renderNodes(nd[3], root, frames, depth, out);
            }
            frames.pop();
          }
        }
        break;
      }
      case 3: {
        const v = resolvePath(root, frames, nd[1]);
        const t = truthy(v);
        if (nd[2] ? !t : t) renderNodes(nd[3], root, frames, depth, out);
        else if (nd[4]) renderNodes(nd[4], root, frames, depth, out);
        break;
      }
      case 4: {
        if (depth < 8) {
          const tpl = TEMPLATES.get(nd[1]);
          if (tpl) renderNodes(tpl, root, frames, depth + 1, out);
        }
        break;
      }
    }
  }
}

function renderTemplate(name, root) {
  const nodes = TEMPLATES.get(name);
  if (!nodes) return '';
  const out = [];
  renderNodes(nodes, root, [], 0, out);
  return out.join('');
}

// ------------------------------------------------------- links and markdown

// Per-run state for link resolution, set by run().
let LINK_BASE = '';
let LINK_PAGE_URLS = null; // Map source path -> page url
let LINK_STATICS = null;   // Set of static file paths
let LINK_BROKEN = null;    // Set of 'broken-link <src> -> <target>' lines
let LINK_SRC = '';
let LINK_DIR = '';

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function resolveLinkTarget(target) {
  if (target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35 || SCHEME_RE.test(target)) {
    return target;
  }
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const frag = hash === -1 ? null : target.slice(hash + 1);
  // Resolve pathPart against LINK_DIR ('.' and '..' steps, never above root).
  const parts = [];
  const baseParts = LINK_DIR === '' ? [] : LINK_DIR.split('/');
  for (const p of baseParts) parts.push(p);
  const segs = pathPart.split('/');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === '' || s === '.') continue;
    if (s === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(s);
  }
  const resolved = parts.join('/');
  let url = LINK_PAGE_URLS.get(resolved);
  if (url === undefined) {
    if (LINK_STATICS.has(resolved)) url = LINK_BASE + '/' + resolved;
  }
  if (url === undefined) {
    LINK_BROKEN.add('broken-link ' + LINK_SRC + ' -> ' + target);
    return target;
  }
  return frag === null ? url : url + '#' + frag;
}

// --- inline rendering -------------------------------------------------------

// Backslash-escapable characters: ` \ * _ [ ] ( ) # + - . ! >
function isEscapable(c) {
  return c === 96 || c === 92 || c === 42 || c === 95 || c === 91 || c === 93 ||
    c === 40 || c === 41 || c === 35 || c === 43 || c === 45 || c === 46 ||
    c === 33 || c === 62;
}

function findStrongCloser(s, from) {
  const n = s.length;
  let j = from;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 42 && s.charCodeAt(j + 1) === 42) {
      if (j > from) return j;
      j += 2;
      continue;
    }
    j++;
  }
  return -1;
}

function findEmCloser(s, from) {
  // A closer is the next single '*' (a '**' is a strong delimiter and is
  // skipped as a pair; an escaped char is skipped as a pair).
  const n = s.length;
  let j = from;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 42) {
      if (s.charCodeAt(j + 1) === 42) { j += 2; continue; }
      if (j > from) return j;
      j++;
      continue;
    }
    j++;
  }
  return -1;
}

function tryLink(s, i) {
  // s[i] === '['. Returns { textStart, textEnd, href, end } or null.
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 93) break;
    j++;
  }
  if (j >= n) return null;
  if (s.charCodeAt(j + 1) !== 40) return null; // '(' must follow at once
  const close = s.indexOf(')', j + 2);
  if (close === -1) return null;
  const target = s.slice(j + 2, close);
  if (target === '') return null;
  for (let k = 0; k < target.length; k++) {
    if (isWhitespaceCode(target.charCodeAt(k))) return null;
  }
  return { textStart: i + 1, textEnd: j, href: resolveLinkTarget(target), end: close + 1 };
}

function renderInline(s, a, b, out) {
  const n = b;
  let i = a;
  let plain = a;
  while (i < n) {
    // Jump to the next inline special char (\, `, *, [) at or after i.
    let next = n;
    let ci = s.indexOf('\\', i);
    if (ci !== -1 && ci < next) next = ci;
    ci = s.indexOf('`', i);
    if (ci !== -1 && ci < next) next = ci;
    ci = s.indexOf('*', i);
    if (ci !== -1 && ci < next) next = ci;
    ci = s.indexOf('[', i);
    if (ci !== -1 && ci < next) next = ci;
    if (next >= n) break;
    i = next;
    const c = s.charCodeAt(i);
    if (c === 92) { // backslash
      if (i + 1 < n && isEscapable(s.charCodeAt(i + 1))) {
        pushEsc(out, s, plain, i);
        if (s.charCodeAt(i + 1) === 62) out.push('&gt;');
        else out.push(s[i + 1]);
        i += 2;
        plain = i;
        continue;
      }
      i++;
    } else if (c === 96) { // backtick: code span
      // A backtick with another backtick at once beside it is itself.
      if (s.charCodeAt(i + 1) === 96) { i++; continue; }
      const j = s.indexOf('`', i + 2);
      if (j === -1 || j >= n) { i++; continue; }
      pushEsc(out, s, plain, i);
      out.push('<code>');
      pushEsc(out, s, i + 1, j);
      out.push('</code>');
      i = j + 1;
      plain = i;
    } else if (c === 42) { // '*'
      if (s.charCodeAt(i + 1) === 42) {
        // Strong: invalid when followed by another '**'.
        if (s.charCodeAt(i + 2) === 42 && s.charCodeAt(i + 3) === 42) { i += 2; continue; }
        const j = findStrongCloser(s, i + 2);
        if (j === -1 || j + 2 > n) { i += 2; continue; }
        pushEsc(out, s, plain, i);
        out.push('<strong>');
        renderInline(s, i + 2, j, out);
        out.push('</strong>');
        i = j + 2;
        plain = i;
      } else {
        const j = findEmCloser(s, i + 1);
        if (j === -1 || j >= n) { i++; continue; }
        pushEsc(out, s, plain, i);
        out.push('<em>');
        renderInline(s, i + 1, j, out);
        out.push('</em>');
        i = j + 1;
        plain = i;
      }
    } else { // '[' (c === 91)
      const link = tryLink(s, i);
      if (!link || link.end > n) { i++; continue; }
      pushEsc(out, s, plain, i);
      out.push('<a href="');
      pushEsc(out, link.href, 0, link.href.length);
      out.push('">');
      renderInline(s, link.textStart, link.textEnd, out);
      out.push('</a>');
      i = link.end;
      plain = i;
    }
  }
  pushEsc(out, s, plain, n);
}

function renderInlineStr(s) {
  const out = [];
  renderInline(s, 0, s.length, out);
  return out.join('');
}

// --- block rendering --------------------------------------------------------

function parseFenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
      c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  for (; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingInfo(line) {
  if (line.charCodeAt(0) !== 35) return null;
  let j = 0;
  while (j < line.length && line.charCodeAt(j) === 35) j++;
  if (j === 0 || j > 6) return null;
  if (j >= line.length) return null;
  const c = line.charCodeAt(j);
  if (c !== 32 && c !== 9) return null;
  let k = j;
  while (k < line.length && isSpaceTab(line.charCodeAt(k))) k++;
  let text = line.slice(k);
  text = text.replace(/[ \t]+$/, '');
  if (text === '') return null;
  return { level: j, text };
}

function isThematicBreak(line) {
  if (line.length < 3) return false;
  const c0 = line.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  if (line.charCodeAt(1) !== c0 || line.charCodeAt(2) !== c0) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function parseListMarker(line) {
  const c0 = line.charCodeAt(0);
  if (c0 === 45 || c0 === 42) {
    if (line.charCodeAt(1) === 32) return { kind: 0, text: line.slice(2), num: 0 };
    return null;
  }
  if (c0 >= 48 && c0 <= 57) {
    let j = 0;
    while (j < line.length) {
      const c = line.charCodeAt(j);
      if (c < 48 || c > 57) break;
      j++;
    }
    if (line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
      return { kind: 1, text: line.slice(j + 2), num: parseInt(line.slice(0, j), 10) };
    }
    return null;
  }
  return null;
}

function renderMarkdown(bodyLines) {
  const out = [];
  const toc = [];
  let excerpt = null;
  const headingTaken = new Set();
  const n = bodyLines.length;
  let i = 0;
  while (i < n) {
    const line = bodyLines[i];
    if (isBlankLine(line)) { i++; continue; }
    // Fence
    const lang = parseFenceOpen(line);
    if (lang !== null) {
      i++;
      out.push('<pre><code' + (lang !== '' ? ' class="language-' + lang + '"' : '') + '>');
      while (i < n) {
        const l = bodyLines[i];
        if (isFenceClose(l)) { i++; break; }
        pushEsc(out, l, 0, l.length);
        out.push('\n');
        i++;
      }
      out.push('</code></pre>\n');
      continue;
    }
    // Heading
    const h = headingInfo(line);
    if (h !== null) {
      const id = uniqueSlug(slugify(h.text), headingTaken);
      const html = renderInlineStr(h.text);
      if (h.level === 2 || h.level === 3) toc.push({ level: h.level, id, html });
      out.push('<h' + h.level + ' id="' + id + '">' + html + '</h' + h.level + '>\n');
      i++;
      continue;
    }
    // Thematic break
    if (isThematicBreak(line)) { out.push('<hr>\n'); i++; continue; }
    // Blockquote
    if (line.charCodeAt(0) === 62) {
      const parts = [];
      while (i < n && bodyLines[i].charCodeAt(0) === 62) {
        let l = bodyLines[i].slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        l = trimST(l);
        if (l !== '') parts.push(l);
        i++;
      }
      if (parts.length > 0) {
        const bq = parts.join('\n');
        out.push('<blockquote>\n<p>');
        renderInline(bq, 0, bq.length, out);
        out.push('</p>\n</blockquote>\n');
      } else {
        out.push('<blockquote>\n</blockquote>\n');
      }
      continue;
    }
    // List
    const marker = parseListMarker(line);
    if (marker !== null) {
      const kind = marker.kind;
      const items = [marker.text];
      const firstNum = marker.num;
      i++;
      while (i < n) {
        const l = bodyLines[i];
        const m = parseListMarker(l);
        if (m !== null && m.kind === kind) { items.push(m.text); i++; continue; }
        // Continuation: two or more spaces/tabs, then a non-space.
        let j = 0;
        while (j < l.length && isSpaceTab(l.charCodeAt(j))) j++;
        if (j >= 2 && j < l.length) {
          items[items.length - 1] += '\n' + trimST(l);
          i++;
          continue;
        }
        break;
      }
      if (kind === 0) out.push('<ul>\n');
      else if (firstNum !== 1) out.push('<ol start="' + firstNum + '">\n');
      else out.push('<ol>\n');
      for (let k = 0; k < items.length; k++) {
        out.push('<li>');
        renderInline(items[k], 0, items[k].length, out);
        out.push('</li>\n');
      }
      out.push(kind === 0 ? '</ul>\n' : '</ol>\n');
      continue;
    }
    // Paragraph: lines up to a blank line, a fence, a heading or a break.
    const pLines = [trimST(line)];
    i++;
    while (i < n) {
      const l = bodyLines[i];
      if (isBlankLine(l)) break;
      if (parseFenceOpen(l) !== null) break;
      if (headingInfo(l) !== null) break;
      if (isThematicBreak(l)) break;
      pLines.push(trimST(l));
      i++;
    }
    const joined = pLines.join('\n');
    if (excerpt === null) {
      const inner = renderInlineStr(joined);
      excerpt = inner;
      out.push('<p>' + inner + '</p>\n');
    } else {
      out.push('<p>');
      renderInline(joined, 0, joined.length, out);
      out.push('</p>\n');
    }
  }
  return { html: out.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ------------------------------------------------------------------ run()

function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function run(input) {
  const site = input.site || {};
  const templatesIn = input.templates || {};
  const filesIn = input.files || [];
  const base = String(site.base_url || '').replace(/\/+$/, '');
  const reportLines = [];

  SLUG_CACHE = new Map();
  TEMPLATES = new Map();
  LINK_BASE = base;
  LINK_BROKEN = new Set();

  // 1. Sources: sorted by path in code-unit order; '.md' are sources.
  const files = filesIn.slice().sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
  const sources = [];
  const statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) {
      const c = f.content;
      sources.push({ path: f.path, content: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else {
      statics.push(f);
    }
  }
  LINK_STATICS = new Set();
  for (let i = 0; i < statics.length; i++) LINK_STATICS.add(statics[i].path);

  // 2. Templates, parsed in code-unit order of name.
  const tplNames = Object.keys(templatesIn).sort();
  for (let i = 0; i < tplNames.length; i++) {
    const name = tplNames[i];
    const parsed = parseTemplate(templatesIn[name]);
    if (parsed.error) reportLines.push('template "' + name + '": ' + parsed.error);
    else TEMPLATES.set(name, parsed.nodes);
  }

  // 3. Front matter and the checks, in order.
  const pages = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const lines = src.content.split('\n');
    const res = parseFrontMatter(lines);
    if (res.error) { reportLines.push('refused ' + src.path + ': ' + res.error); continue; }
    const fm = res.fm;
    const isPost = src.path.startsWith('posts/');
    const slash = src.path.indexOf('/');
    const firstSeg = slash === -1 ? '' : src.path.slice(0, slash);
    if (firstSeg === 'tags' || firstSeg === 'page') {
      reportLines.push('refused ' + src.path + ': ' + firstSeg + '/ is the generator\'s own');
      continue;
    }
    if (isPost && !fm.date) {
      reportLines.push('refused ' + src.path + ': a post needs a date');
      continue;
    }
    const layout = fm.layout || (isPost ? 'post' : 'page');
    if (!TEMPLATES.has(layout)) {
      reportLines.push('refused ' + src.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    if (fm.draft === true) { reportLines.push('draft ' + src.path); continue; }
    pages.push({
      path: src.path, fm, isPost, layout,
      bodyLines: lines.slice(res.bodyStart),
      dir: isPost ? 'posts' : dirOf(src.path),
    });
  }

  // 4. Permalinks, unique in their directory in source order.
  const takenByDir = new Map();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let taken = takenByDir.get(p.dir);
    if (!taken) {
      taken = new Set();
      if (p.dir === '') { taken.add('posts'); taken.add('tags'); taken.add('page'); }
      takenByDir.set(p.dir, taken);
    }
    const baseSlug = p.fm.slug || slugify(p.fm.title);
    p.slug = uniqueSlug(baseSlug, taken);
    p.outPath = (p.dir === '' ? '' : p.dir + '/') + p.slug + '/index.html';
    p.url = base + '/' + (p.dir === '' ? '' : p.dir + '/') + p.slug + '/';
  }

  // 5. Markdown, each source's body rendered to HTML, links resolved.
  LINK_PAGE_URLS = new Map();
  for (let i = 0; i < pages.length; i++) LINK_PAGE_URLS.set(pages[i].path, pages[i].url);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    LINK_SRC = p.path;
    LINK_DIR = dirOf(p.path);
    const md = renderMarkdown(p.bodyLines);
    p.content = md.html;
    p.toc = md.toc;
    p.excerpt = md.excerpt;
    p.readingMinutes = Math.max(1, Math.ceil(countWords(p.bodyLines) / 200));
  }

  // 6. Collections: posts, newest date first, equal dates by slug.
  const posts = [];
  for (let i = 0; i < pages.length; i++) if (pages[i].isPost) posts.push(pages[i]);
  posts.sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
    return a.slug < b.slug ? -1 : (a.slug > b.slug ? 1 : 0);
  });
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? posts[i - 1] : null;
    posts[i].older = i < posts.length - 1 ? posts[i + 1] : null;
  }

  // 7. Tags: each post's tags, each slug once (first spelling kept).
  const tagBySlug = new Map();
  const tagList = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const seen = new Set();
    const tags = post.fm.tags || [];
    for (let k = 0; k < tags.length; k++) {
      const slug = slugify(tags[k]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = tagBySlug.get(slug);
      if (!tag) {
        tag = { name: tags[k], slug, url: base + '/tags/' + slug + '/', posts: [] };
        tagBySlug.set(slug, tag);
        tagList.push(tag);
      }
      tag.posts.push(post);
    }
  }
  tagList.sort((a, b) => {
    const d = b.posts.length - a.posts.length;
    if (d !== 0) return d;
    return a.slug < b.slug ? -1 : (a.slug > b.slug ? 1 : 0);
  });
  for (let i = 0; i < tagList.length; i++) tagList[i].count = tagList[i].posts.length;
  const tagsCtx = tagList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  // Each page's tags link to the tag of the same slug (taking its name),
  // or have url "" where no post has that tag.
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const seen = new Set();
    const ptags = [];
    const tags = p.fm.tags || [];
    for (let k = 0; k < tags.length; k++) {
      const slug = slugify(tags[k]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const g = tagBySlug.get(slug);
      if (g) ptags.push({ name: g.name, slug, url: g.url });
      else ptags.push({ name: tags[k], slug, url: '' });
    }
    p.tags = ptags;
  }

  // Cards and page objects.
  function makeCard(p) {
    return {
      title: p.fm.title,
      url: p.url,
      date: p.fm.date || '',
      date_long: p.fm.date ? dateLong(p.fm.date) : '',
      summary: p.fm.summary || '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: p.tags,
    };
  }
  function neighbourCard(p) {
    if (!p) return null;
    return { title: p.fm.title, url: p.url, date: p.fm.date || '', date_long: p.fm.date ? dateLong(p.fm.date) : '' };
  }
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.card = makeCard(p);
    p.pageObj = p.card;
    p.pageObj.slug = p.slug;
    p.pageObj.content = p.content;
    p.pageObj.toc = p.toc;
    p.pageObj.newer = p.isPost ? neighbourCard(p.newer) : null;
    p.pageObj.older = p.isPost ? neighbourCard(p.older) : null;
    p.pageObj.is_post = p.isPost;
  }

  // 8. Layouts.
  const output = {};
  const siteCtx = { title: site.title, base_url: base };
  const recentCards = posts.slice(0, site.recent).map((p) => p.card);

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    output[p.outPath] = renderTemplate(p.layout, {
      site: siteCtx, tags: tagsCtx, recent: recentCards, page: p.pageObj,
    });
  }

  const perPage = (typeof site.per_page === 'number' && site.per_page > 0)
    ? site.per_page : (posts.length || 1);
  let totalPages = Math.ceil(posts.length / perPage);
  if (!(totalPages >= 1)) totalPages = 1;
  if (TEMPLATES.has('index')) {
    for (let i = 1; i <= totalPages; i++) {
      const pagePosts = posts.slice((i - 1) * perPage, i * perPage).map((p) => p.card);
      const pager = {
        number: i,
        total: totalPages,
        url: i === 1 ? base + '/' : base + '/page/' + i + '/',
        newer_url: i > 1 ? (i - 1 === 1 ? base + '/' : base + '/page/' + (i - 1) + '/') : '',
        older_url: i < totalPages ? base + '/page/' + (i + 1) + '/' : '',
      };
      output[i === 1 ? 'index.html' : 'page/' + i + '/index.html'] = renderTemplate('index', {
        site: siteCtx, tags: tagsCtx, recent: recentCards, posts: pagePosts, pager,
      });
    }
  }

  if (TEMPLATES.has('tag')) {
    for (let i = 0; i < tagList.length; i++) {
      const t = tagList[i];
      const tagObj = {
        name: t.name, slug: t.slug, url: t.url, count: t.count,
        posts: t.posts.map((p) => p.card),
      };
      output['tags/' + t.slug + '/index.html'] = renderTemplate('tag', {
        site: siteCtx, tags: tagsCtx, recent: recentCards, tag: tagObj,
      });
    }
  }

  if (TEMPLATES.has('tags')) {
    output['tags/index.html'] = renderTemplate('tags', {
      site: siteCtx, tags: tagsCtx, recent: recentCards,
    });
  }

  // Static files, unless a built page has their path.
  const builtPaths = new Set(Object.keys(output));
  let staticCount = 0;
  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (builtPaths.has(f.path)) {
      reportLines.push('shadowed ' + f.path + ': a built page has its path');
      continue;
    }
    output[f.path] = f.content;
    staticCount++;
  }

  // 9. The report.
  const allLines = reportLines.concat(Array.from(LINK_BROKEN));
  allLines.sort();
  const builtLine = 'built ' + (pages.length - posts.length) + ' pages, ' + posts.length +
    ' posts, ' + tagList.length + ' tags and ' + staticCount + ' static files';
  output['build-report.txt'] = (allLines.length > 0 ? allLines.join('\n') + '\n' : '') + builtLine + '\n';

  return output;
}
