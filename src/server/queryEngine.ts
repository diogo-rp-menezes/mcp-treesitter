import { ASTNode, QueryCapture, QueryMatch } from './types';

interface QueryPattern {
  targetNodeType: string;
  field?: string;
  captureName?: string;
  childPatterns: QueryPattern[];
  predicates: Array<{ type: 'eq'; capture: string; value: string }>;
}

export function parseSExpressionQuery(queryString: string): QueryPattern[] {
  const patterns: QueryPattern[] = [];

  // Remove comment lines starting with ';'
  const cleaned = queryString
    .split('\n')
    .map((line) => line.replace(/;.*$/, ''))
    .join(' ')
    .trim();

  if (!cleaned) return [];

  // Handle alternations [ (pattern1) (pattern2) ]
  let working = cleaned;
  if (working.startsWith('[') && working.endsWith(']')) {
    working = working.slice(1, -1).trim();
  }

  // Tokenize parentheses, identifiers, captures @foo, and strings
  const tokens: string[] = [];
  let idx = 0;
  while (idx < working.length) {
    const ch = working[idx];
    if (/\s/.test(ch)) {
      idx++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
      tokens.push(ch);
      idx++;
      continue;
    }
    if (ch === '"') {
      let str = '';
      idx++;
      while (idx < working.length && working[idx] !== '"') {
        if (working[idx] === '\\') {
          idx++;
          str += working[idx] || '';
        } else {
          str += working[idx];
        }
        idx++;
      }
      idx++; // skip closing "
      tokens.push(`"${str}"`);
      continue;
    }

    // Read word/symbol
    let word = '';
    while (idx < working.length && !/\s|\(|\)|\[|\]/.test(working[idx])) {
      word += working[idx];
      idx++;
    }
    if (word) {
      tokens.push(word);
    }
  }

  // Parse pattern tree
  let pos = 0;
  while (pos < tokens.length) {
    if (tokens[pos] === '(') {
      const parsed = parsePatternNode(tokens);
      if (parsed) {
        patterns.push(parsed);
      }
    } else {
      pos++;
    }
  }

  function parsePatternNode(toks: string[]): QueryPattern | null {
    if (toks[pos] !== '(') return null;
    pos++; // consume '('

    const first = toks[pos];
    pos++; // consume node type

    const pattern: QueryPattern = {
      targetNodeType: first?.replace('?', '') || '*',
      childPatterns: [],
      predicates: [],
    };

    while (pos < toks.length && toks[pos] !== ')') {
      const current = toks[pos];

      if (current === '(') {
        const child = parsePatternNode(toks);
        if (child) {
          pattern.childPatterns.push(child);
        }
        continue;
      }

      if (current.endsWith(':')) {
        // Field name
        const fieldName = current.slice(0, -1);
        pos++;
        if (pos < toks.length && toks[pos] === '(') {
          const child = parsePatternNode(toks);
          if (child) {
            child.field = fieldName;
            pattern.childPatterns.push(child);
          }
        }
        continue;
      }

      if (current.startsWith('@')) {
        pattern.captureName = current.slice(1);
        pos++;
        continue;
      }

      if (current.startsWith('#eq?')) {
        pos++;
        const cap = toks[pos]?.startsWith('@') ? toks[pos].slice(1) : toks[pos];
        pos++;
        const val = toks[pos]?.replace(/^"|"$/g, '') || '';
        pos++;
        pattern.predicates.push({ type: 'eq', capture: cap, value: val });
        continue;
      }

      pos++;
    }

    if (pos < toks.length && toks[pos] === ')') {
      pos++; // consume ')'
    }

    // Check if trailing @capture exists after closing paren
    if (pos < toks.length && toks[pos]?.startsWith('@')) {
      pattern.captureName = toks[pos].slice(1);
      pos++;
    }

    return pattern;
  }

  return patterns;
}

export function executeQuery(
  ast: ASTNode,
  queryString: string,
  options: {
    maxResults?: number;
    captureFilter?: string;
    compact?: boolean;
  } = {}
): QueryMatch[] {
  const patterns = parseSExpressionQuery(queryString);
  const matches: QueryMatch[] = [];
  const maxResults = options.maxResults || 100;

  function matchPatternOnNode(pattern: QueryPattern, node: ASTNode): QueryCapture[] | null {
    if (pattern.targetNodeType !== '*' && node.type !== pattern.targetNodeType) {
      return null;
    }
    if (pattern.field && node.field && node.field !== pattern.field) {
      return null;
    }

    const captures: QueryCapture[] = [];

    if (pattern.captureName) {
      captures.push({
        capture: pattern.captureName,
        text: node.text || '',
        nodeType: node.type,
        startPoint: node.startPoint,
        endPoint: node.endPoint,
      });
    }

    // Check child patterns
    for (const cp of pattern.childPatterns) {
      let childMatched = false;
      for (const childNode of node.children) {
        const subCaps = matchPatternOnNode(cp, childNode);
        if (subCaps) {
          captures.push(...subCaps);
          childMatched = true;
          break;
        }
      }
      if (!childMatched && !cp.targetNodeType.includes('?')) {
        // Child requirement not met
        return null;
      }
    }

    // Predicates
    for (const pred of pattern.predicates) {
      if (pred.type === 'eq') {
        const found = captures.find((c) => c.capture === pred.capture);
        if (!found || found.text !== pred.value) {
          return null;
        }
      }
    }

    return captures;
  }

  function search(node: ASTNode) {
    if (matches.length >= maxResults) return;

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const p = patterns[pIdx];
      const caps = matchPatternOnNode(p, node);
      if (caps && caps.length > 0) {
        let filteredCaps = caps;
        if (options.captureFilter) {
          filteredCaps = caps.filter((c) => c.capture === options.captureFilter);
        }

        if (filteredCaps.length > 0) {
          matches.push({
            patternIndex: pIdx,
            captures: filteredCaps,
            matchedText: node.text?.trim() || '',
          });
        }
      }
    }

    for (const child of node.children) {
      search(child);
    }
  }

  search(ast);
  return matches;
}
