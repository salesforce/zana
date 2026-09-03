// Host-side evaluator for an extension command's declarative `when` visibility
// expression. Extensions ship a STRING (never a predicate function — a closure
// can't cross the utilityProcess isolation boundary, and host-evaluating
// attacker-authored code would defeat the broker model). Core parses and
// evaluates that string here, against a FIXED, coarse, non-sensitive context.
//
// Security posture (per the trust-boundary review):
//   • The vocabulary is an allowlist of booleans/enums derived from existing
//     stores. It deliberately excludes sensitive state — project path/name,
//     session titles/contents, file names, cwd, other extensions' state, inbox
//     contents. An expression can only ask coarse questions ("is a project
//     selected?", "which nav is active?"), never read data.
//   • Fail CLOSED: an unknown key, a parse error, or any thrown evaluation
//     hides the command (returns false). A command never appears because its
//     `when` was malformed.
//
// Grammar (minimal, intentionally not a full expression language):
//   expr    := or
//   or      := and ( '||' and )*
//   and     := unary ( '&&' unary )*
//   unary   := '!' unary | primary
//   primary := '(' expr ')' | comparison | key
//   comparison := key ('==' | '!=') value
//   key     := ident ( '.' ident )*        e.g. activeNav, activeTabStatus
//   value   := ident | string | number | true | false
// A bare `key` is truthy-tested (booleans → themselves; strings/numbers →
// non-empty/non-zero), so `when: "hasActiveProject"` works without `== true`.

/** The coarse, non-sensitive context an extension `when` may read. */
export interface WhenContext {
  /** Active sidebar nav id (e.g. 'projects', 'settings', or a module id). */
  activeNav: string;
  /** Is a project selected in the shell? (boolean only — never the path/name) */
  hasActiveProject: boolean;
  /** Is there an active tab in the selected project? */
  hasActiveTab: boolean;
  /** Number of visible tabs in the selected project. */
  tabCount: number;
  /** Active tab status (e.g. 'running' | 'exited'), or '' when none. */
  activeTabStatus: string;
  /** Active tab launch profile (e.g. 'claude' | 'shell'), or '' when none. */
  activeTabProfile: string;
  /** Active project view of the selected project ('terminals' | 'explorer' | …). */
  projectView: string;
  /** OS platform: 'darwin' | 'win32' | 'linux'. */
  platform: string;
  /**
   * True when the evaluating extension's OWN panel/nav is the active nav. Scoped
   * per-command at call time (the adapter passes the owning module id), so an
   * extension can't probe whether a *different* extension's panel is focused.
   */
  panelFocused: boolean;
  /**
   * True in a per-project window (one locked to a single project). Lets a
   * command hide itself when it only makes sense in the full, unscoped shell —
   * or vice-versa. A boolean (not the id) to keep this context non-sensitive,
   * matching `hasActiveProject`; the id itself is on the host (getScopedProjectId).
   */
  scopedWindow: boolean;
}

type Primitive = string | number | boolean;

// --- tiny recursive-descent parser/evaluator ------------------------------
// We parse-and-evaluate in one pass over a token list. The token list is tiny
// (a `when` is a handful of terms), so there's no need to build an AST.

const TOKEN_RE = /\s*(\|\||&&|==|!=|!|\(|\)|"[^"]*"|'[^']*'|[A-Za-z0-9_.]+)/y;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = TOKEN_RE.exec(src))) {
    tokens.push(m[1]);
    consumed = TOKEN_RE.lastIndex;
    if (TOKEN_RE.lastIndex === 0) break; // safety
  }
  // Anything left over (e.g. a stray symbol the regex didn't match) → malformed.
  if (consumed < src.trimEnd().length) throw new Error('unexpected token');
  return tokens;
}

function literalValue(tok: string): Primitive {
  if (tok === 'true') return true;
  if (tok === 'false') return false;
  if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
    return tok.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  return tok; // bare ident used as a string value (e.g. activeNav == projects)
}

function isContextKey(tok: string): boolean {
  // A key is an identifier that isn't a reserved literal. We treat any
  // dotted/bare ident that resolves in the context as a key; unknown keys throw
  // (fail-closed) when read.
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(tok) && tok !== 'true' && tok !== 'false';
}

function readKey(ctx: WhenContext, key: string): Primitive {
  const resolved = key === 'workspaceMode' ? 'projectView' : key;
  if (Object.prototype.hasOwnProperty.call(ctx, resolved)) {
    return (ctx as unknown as Record<string, Primitive>)[resolved];
  }
  throw new Error(`unknown context key: ${key}`);
}

function truthy(v: Primitive): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v !== '';
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: string[], private readonly ctx: WhenContext) {}

  evaluate(): boolean {
    const v = this.parseOr();
    if (this.pos < this.tokens.length) throw new Error('trailing tokens');
    return v;
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }
  private next(): string {
    const t = this.tokens[this.pos++];
    if (t === undefined) throw new Error('unexpected end');
    return t;
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek() === '||') {
      this.next();
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseUnary();
    while (this.peek() === '&&') {
      this.next();
      const right = this.parseUnary();
      left = left && right;
    }
    return left;
  }

  private parseUnary(): boolean {
    if (this.peek() === '!') {
      this.next();
      return !this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): boolean {
    const tok = this.peek();
    if (tok === '(') {
      this.next();
      const v = this.parseOr();
      if (this.next() !== ')') throw new Error('expected )');
      return v;
    }
    if (tok === undefined || tok === ')' || tok === '||' || tok === '&&') {
      throw new Error('expected term');
    }
    // key, optionally followed by a comparison
    if (!isContextKey(tok)) throw new Error(`expected key, got ${tok}`);
    this.next();
    const keyVal = readKey(this.ctx, tok);
    const op = this.peek();
    if (op === '==' || op === '!=') {
      this.next();
      const rhs = literalValue(this.next());
      const eq = keyVal === rhs;
      return op === '==' ? eq : !eq;
    }
    return truthy(keyVal);
  }
}

/**
 * Evaluate a `when` expression against the context. Returns true (visible) when
 * `expr` is absent/empty. Returns false (hidden) on ANY parse/eval failure or
 * unknown key — fail-closed.
 */
export function evaluateWhen(expr: string | undefined, ctx: WhenContext): boolean {
  if (expr === undefined || expr.trim() === '') return true;
  try {
    const tokens = tokenize(expr.trim());
    if (tokens.length === 0) return true;
    return new Parser(tokens, ctx).evaluate();
  } catch {
    return false; // malformed / unknown key → hidden
  }
}
