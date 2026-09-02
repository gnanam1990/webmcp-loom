import type {
  AgentToolResult,
  JsonValue,
  RuntimeTool,
  RuntimeToolSelector,
  RuntimeToolSelectorContext,
} from '@webmcp-loom/runtime';

const DEFAULT_MAX_TOOLS = 4;
const MAX_CONFIGURED_TOOLS = 20;
const MAX_EVIDENCE_KEYS = 64;
const MAX_EVIDENCE_DEPTH = 5;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'one', 'or', 'that', 'the', 'this', 'to', 'with',
]);

const READ_ONLY_INTENT = /(?:\bread[ -]?only\b|\b(?:do not|don['’]?t|dont|never)\s+(?:(?:apply|make)\s+)?(?:any\s+)?(?:change|changes|edit|edits|write|writes)\b|\b(?:do not|don['’]?t|dont|never)\s+(?:add|create|delete|drop|edit|include|move|remove|reschedule|shift|stage|update|write)\s+(?:anything|it|that|them|this|the\s+(?:board|item|option|plan|result|state))\b|\bwithout\s+(?:changing|editing|writing(?:\s+to)?)\s+(?:anything|it|the\s+(?:board|plan|state))\b)/i;
const REFERENCE_FIELD = /(?:^id$|(?:item|ref|source|target)[A-Z_ -]*id$)/i;
const REVISION_FIELD = /revision/i;
const BASE_MUTATION_VERBS = [
  'add', 'create', 'delete', 'drop', 'edit', 'include', 'move', 'remove',
  'reschedule', 'shift', 'stage', 'update', 'write',
] as const;

export interface DeterministicToolSelectorOptions {
  /** Maximum prompt-visible tools. Defaults to four. */
  maxTools?: number;
  /** Domain vocabulary groups. Every token in a group is treated as equivalent. */
  synonymGroups?: readonly (readonly string[])[];
}

export interface RankedRuntimeTool {
  name: string;
  score: number;
}

interface NormalizedOptions {
  affirmativeWriteIntent: RegExp;
  maxTools: number;
  synonyms: ReadonlyMap<string, ReadonlySet<string>>;
}

interface HistoryEvidence {
  hasIdentifier: boolean;
  hasRevision: boolean;
  tokens: ReadonlySet<string>;
}

/**
 * Builds a deterministic lexical selector for the runtime's prompt-only hook.
 *
 * The selector never executes a tool and never changes the canonical registry.
 * Reference-bearing writes stay out of the prompt until a successful earlier
 * result supplies both their identifier and revision prerequisites.
 */
export function createDeterministicToolSelector(
  options: DeterministicToolSelectorOptions = {},
): RuntimeToolSelector {
  const normalized = normalizeOptions(options);
  return (context) => rankRuntimeToolsWithOptions(context, normalized)
    .slice(0, normalized.maxTools)
    .map(({ name }) => name);
}

/** Exposes the stable ordering for tests, trace tooling and benchmark metadata. */
export function rankRuntimeTools(
  context: RuntimeToolSelectorContext,
  options: DeterministicToolSelectorOptions = {},
): readonly RankedRuntimeTool[] {
  return rankRuntimeToolsWithOptions(context, normalizeOptions(options));
}

function rankRuntimeToolsWithOptions(
  context: RuntimeToolSelectorContext,
  options: NormalizedOptions,
): RankedRuntimeTool[] {
  if (context.tools.length === 0) return [];
  const historyEvidence = inspectHistory(context.history);
  const goalTokens = expandTokens(tokenize(context.goal), options.synonyms);
  const queryTokens = new Set([...goalTokens, ...historyEvidence.tokens]);
  const readOnlyIntent = READ_ONLY_INTENT.test(context.goal)
    && !options.affirmativeWriteIntent.test(context.goal);

  const ranked = context.tools.flatMap((tool, index) => {
    if (!isEligible(tool, historyEvidence, readOnlyIntent)) return [];
    const nameTokens = expandTokens(tokenize(tool.name), options.synonyms);
    const titleTokens = expandTokens(tokenize(tool.title), options.synonyms);
    const descriptionTokens = expandTokens(tokenize(tool.description), options.synonyms);
    const schemaTokens = expandTokens(tokenize(JSON.stringify(tool.inputSchema)), options.synonyms);
    let score = overlapScore(queryTokens, nameTokens, 8)
      + overlapScore(queryTokens, titleTokens, 5)
      + overlapScore(queryTokens, descriptionTokens, 3)
      + overlapScore(queryTokens, schemaTokens, 1);

    if (context.history.length === 0 && tool.annotations.readOnlyHint) score += 4;
    if (context.history.length > 0 && !tool.annotations.readOnlyHint) score += 4;
    if (context.history.at(-1)?.tool === tool.name) score -= 1;
    return [{ index, name: tool.name, score }];
  });

  // A write-only page may have no history-backed candidate yet. The selector
  // is prompt shaping, not a policy boundary, so fall back to the advertised
  // surface instead of turning a valid runtime configuration into an error.
  const candidates = ranked.length > 0
    ? ranked
    : context.tools.map((tool, index) => ({ index, name: tool.name, score: 0 }));
  return candidates
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ name, score }) => ({ name, score }));
}

function isEligible(
  tool: RuntimeTool,
  evidence: HistoryEvidence,
  readOnlyIntent: boolean,
): boolean {
  if (tool.annotations.readOnlyHint) return true;
  if (readOnlyIntent) return false;
  const required = requiredProperties(tool);
  if (required.some((field) => REFERENCE_FIELD.test(field)) && !evidence.hasIdentifier) return false;
  if (required.some((field) => REVISION_FIELD.test(field)) && !evidence.hasRevision) return false;
  return true;
}

function requiredProperties(tool: RuntimeTool): readonly string[] {
  const required = tool.inputSchema.required;
  return Array.isArray(required)
    ? required.filter((field): field is string => typeof field === 'string')
    : [];
}

function inspectHistory(history: readonly AgentToolResult[]): HistoryEvidence {
  const keys = new Set<string>();
  let hasIdentifier = false;
  let hasRevision = false;
  for (const entry of history) {
    for (const token of tokenize(entry.tool)) keys.add(token);
    if (!entry.ok || entry.output === undefined) continue;
    const evidence = inspectValue(entry.output, keys, 0);
    hasIdentifier ||= evidence.hasIdentifier;
    hasRevision ||= evidence.hasRevision;
  }
  return { hasIdentifier, hasRevision, tokens: keys };
}

function inspectValue(
  value: JsonValue,
  keys: Set<string>,
  depth: number,
): Pick<HistoryEvidence, 'hasIdentifier' | 'hasRevision'> {
  if (depth > MAX_EVIDENCE_DEPTH || keys.size >= MAX_EVIDENCE_KEYS) {
    return { hasIdentifier: false, hasRevision: false };
  }
  if (Array.isArray(value)) {
    let hasIdentifier = false;
    let hasRevision = false;
    for (const entry of value) {
      const nested = inspectValue(entry, keys, depth + 1);
      hasIdentifier ||= nested.hasIdentifier;
      hasRevision ||= nested.hasRevision;
      if (keys.size >= MAX_EVIDENCE_KEYS) break;
    }
    return { hasIdentifier, hasRevision };
  }
  if (typeof value !== 'object' || value === null) {
    return { hasIdentifier: false, hasRevision: false };
  }

  let hasIdentifier = false;
  let hasRevision = false;
  for (const [key, nestedValue] of Object.entries(value)) {
    for (const token of tokenize(key)) keys.add(token);
    const scalarEvidence = typeof nestedValue === 'string' || typeof nestedValue === 'number';
    if (scalarEvidence && REFERENCE_FIELD.test(key)) hasIdentifier = true;
    if (scalarEvidence && REVISION_FIELD.test(key)) hasRevision = true;
    const nested = inspectValue(nestedValue, keys, depth + 1);
    hasIdentifier ||= nested.hasIdentifier;
    hasRevision ||= nested.hasRevision;
    if (keys.size >= MAX_EVIDENCE_KEYS) break;
  }
  return { hasIdentifier, hasRevision };
}

function normalizeOptions(options: DeterministicToolSelectorOptions): NormalizedOptions {
  const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
  if (!Number.isInteger(maxTools) || maxTools < 1 || maxTools > MAX_CONFIGURED_TOOLS) {
    throw new Error(`maxTools must be an integer from 1 to ${MAX_CONFIGURED_TOOLS}.`);
  }
  const synonyms = new Map<string, ReadonlySet<string>>();
  for (const group of options.synonymGroups ?? []) {
    const groupTokens = new Set(group.flatMap((entry) => tokenize(entry)));
    if (groupTokens.size < 2) continue;
    const frozen = new Set(groupTokens);
    for (const token of groupTokens) synonyms.set(token, frozen);
  }
  return {
    affirmativeWriteIntent: buildAffirmativeWriteIntent(synonyms),
    maxTools,
    synonyms,
  };
}

function buildAffirmativeWriteIntent(
  synonyms: ReadonlyMap<string, ReadonlySet<string>>,
): RegExp {
  const verbs = new Set<string>(BASE_MUTATION_VERBS);
  for (const verb of BASE_MUTATION_VERBS) {
    for (const synonym of synonyms.get(verb) ?? []) verbs.add(synonym);
  }
  const alternatives = [...verbs].sort((left, right) => right.length - left.length).join('|');
  const clauseStart = String.raw`(?:^\s*|[.!?;]\s*|\b(?:and|then)\s+)`;
  const politePrefix = String.raw`(?:(?:please(?:,|\s)+)|(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?)|(?:i\s+need\s+(?:you\s+)?to\s+)|(?:i(?:['’]d|\s+would)\s+like\s+(?:you\s+)?to\s+)|(?:help\s+me\s+(?:to\s+)?))?`;
  // `nothing`, `no`, and `not` negate the command. `move on` is an idiom,
  // not a request to invoke a move tool.
  const negativeObjectOrIdiom = String.raw`(?!\s+(?:no|not|nothing|on)\b)`;
  return new RegExp(
    `${clauseStart}${politePrefix}(?:just\\s+)?(?:${alternatives})\\b${negativeObjectOrIdiom}`,
    'i',
  );
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(stem)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function expandTokens(
  tokens: readonly string[],
  synonyms: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const synonym of synonyms.get(token) ?? []) expanded.add(synonym);
  }
  return expanded;
}

function overlapScore(
  query: ReadonlySet<string>,
  document: ReadonlySet<string>,
  weight: number,
): number {
  let score = 0;
  for (const token of query) {
    if (document.has(token)) score += weight;
  }
  return score;
}
