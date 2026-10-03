import { ASTNode, QueryCapture, QueryMatch } from './types';

export type PredicateType = 'eq' | 'not-eq' | 'match' | 'not-match' | 'any-of';

export interface QueryPredicate {
  type: PredicateType;
  capture: string;
  value?: string;
  values?: string[];
  otherCapture?: string;
  regex?: RegExp;
}

export interface QueryPattern {
  targetNodeType: string;
  field?: string;
  negatedFields: string[];
  quantifier: '+' | '*' | '?' | '1';
  captureName?: string;
  childPatterns: QueryPattern[];
  predicates: QueryPredicate[];
  isImmediateChild?: boolean;
}

export function parseSExpressionQuery(queryString: string): QueryPattern[] {
  const patterns: QueryPattern[] = [];

  // Remove comments (lines starting with ';')
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

  // Tokenize parentheses, identifiers, captures @foo, strings, and predicates #foo
  const tokens: string[] = [];
  let idx = 0;
  while (idx < working.length) {
    const ch = working[idx];
    if (/\s/.test(ch)) {
      idx++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '.') {
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

    // Read identifier/word/predicate/quantified symbol
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

    let targetNodeType = first || '*';
    let quantifier: '+' | '*' | '?' | '1' = '1';

    if (targetNodeType.endsWith('+')) {
      quantifier = '+';
      targetNodeType = targetNodeType.slice(0, -1);
    } else if (targetNodeType.endsWith('*')) {
      quantifier = '*';
      targetNodeType = targetNodeType.slice(0, -1);
    } else if (targetNodeType.endsWith('?')) {
      quantifier = '?';
      targetNodeType = targetNodeType.slice(0, -1);
    }

    const pattern: QueryPattern = {
      targetNodeType: targetNodeType || '*',
      quantifier,
      negatedFields: [],
      childPatterns: [],
      predicates: [],
    };

    while (pos < toks.length && toks[pos] !== ')') {
      const current = toks[pos];

      // Immediate child sibling anchor (.)
      if (current === '.') {
        pos++;
        if (pos < toks.length && toks[pos] === '(') {
          const child = parsePatternNode(toks);
          if (child) {
            child.isImmediateChild = true;
            pattern.childPatterns.push(child);
          }
        }
        continue;
      }

      // Check if parentheses encapsulate a predicate e.g. (#match? @fn "^get_")
      if (current === '(' && toks[pos + 1]?.startsWith('#')) {
        pos++; // consume '('
        parsePredicate(pattern, toks);
        if (pos < toks.length && toks[pos] === ')') {
          pos++; // consume ')'
        }
        continue;
      }

      // Check if parentheses encapsulate a negated field e.g. (!parameters)
      if (current === '(' && toks[pos + 1]?.startsWith('!')) {
        pos++; // consume '('
        const negField = (toks[pos] || '').slice(1);
        if (negField) pattern.negatedFields.push(negField);
        pos++;
        if (pos < toks.length && toks[pos] === ')') {
          pos++; // consume ')'
        }
        continue;
      }

      // Child sub-pattern
      if (current === '(') {
        const child = parsePatternNode(toks);
        if (child) {
          pattern.childPatterns.push(child);
        }
        continue;
      }

      // Negated field (!field)
      if (current.startsWith('!')) {
        const negField = current.slice(1);
        if (negField) pattern.negatedFields.push(negField);
        pos++;
        continue;
      }

      // Named field (field_name:)
      if (current.endsWith(':')) {
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

      // Capture name (@func.name)
      if (current.startsWith('@')) {
        pattern.captureName = current.slice(1);
        pos++;
        continue;
      }

      // Bare predicates without parentheses e.g. #match? @fn "^get_"
      if (current.startsWith('#')) {
        parsePredicate(pattern, toks);
        continue;
      }

      pos++;
    }

    if (pos < toks.length && toks[pos] === ')') {
      pos++; // consume ')'
    }

    // Check if trailing quantifier exists after closing paren e.g. (statement)+
    if (pos < toks.length && (toks[pos] === '+' || toks[pos] === '*' || toks[pos] === '?')) {
      pattern.quantifier = toks[pos] as '+' | '*' | '?';
      pos++;
    }

    // Check if trailing @capture exists after closing paren e.g. (identifier) @name
    if (pos < toks.length && toks[pos]?.startsWith('@')) {
      pattern.captureName = toks[pos].slice(1);
      pos++;
    }

    return pattern;
  }

  function parsePredicate(pattern: QueryPattern, toks: string[]) {
    const predName = toks[pos];
    pos++;

    if (predName === '#eq?' || predName === '#not-eq?') {
      const cap = (toks[pos] || '').replace(/^@/, '');
      pos++;
      const valToken = toks[pos] || '';
      pos++;

      if (valToken.startsWith('@')) {
        // Comparison between two captures: (#eq? @c1 @c2)
        pattern.predicates.push({
          type: predName === '#eq?' ? 'eq' : 'not-eq',
          capture: cap,
          otherCapture: valToken.slice(1),
        });
      } else {
        // Comparison between capture and string literal
        pattern.predicates.push({
          type: predName === '#eq?' ? 'eq' : 'not-eq',
          capture: cap,
          value: valToken.replace(/^"|"$/g, ''),
        });
      }
    } else if (predName === '#match?' || predName === '#not-match?') {
      const cap = (toks[pos] || '').replace(/^@/, '');
      pos++;
      const patternStr = (toks[pos] || '').replace(/^"|"$/g, '');
      pos++;
      try {
        pattern.predicates.push({
          type: predName === '#match?' ? 'match' : 'not-match',
          capture: cap,
          value: patternStr,
          regex: new RegExp(patternStr),
        });
      } catch {
        // ignore invalid regex
      }
    } else if (predName === '#any-of?') {
      const cap = (toks[pos] || '').replace(/^@/, '');
      pos++;
      const allowedValues: string[] = [];
      while (
        pos < toks.length &&
        (toks[pos].startsWith('"') ||
          (!toks[pos].startsWith('#') && !toks[pos].startsWith('(') && toks[pos] !== ')'))
      ) {
        allowedValues.push(toks[pos].replace(/^"|"$/g, ''));
        pos++;
      }
      pattern.predicates.push({ type: 'any-of', capture: cap, values: allowedValues });
    }
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

    // Check negated fields (!field)
    for (const negField of pattern.negatedFields) {
      const hasNegatedField = node.children.some((c) => c.field === negField);
      if (hasNegatedField) {
        return null;
      }
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
      let matchedCount = 0;

      function matchInSubtree(parent: ASTNode): QueryCapture[] | null {
        for (const childNode of parent.children) {
          const subCaps = matchPatternOnNode(cp, childNode);
          if (subCaps) return subCaps;
          if (childNode.type === 'block' || childNode.type === 'statement_block' || childNode.type === 'body') {
            const nestedCaps = matchInSubtree(childNode);
            if (nestedCaps) return nestedCaps;
          }
        }
        return null;
      }

      for (const childNode of node.children) {
        const subCaps = matchPatternOnNode(cp, childNode);
        if (subCaps) {
          captures.push(...subCaps);
          matchedCount++;
          if (cp.quantifier !== '*' && cp.quantifier !== '+') {
            break;
          }
        } else if (childNode.type === 'block' || childNode.type === 'statement_block') {
          const nestedCaps = matchInSubtree(childNode);
          if (nestedCaps) {
            captures.push(...nestedCaps);
            matchedCount++;
            if (cp.quantifier !== '*' && cp.quantifier !== '+') {
              break;
            }
          }
        }
      }

      if (matchedCount === 0) {
        if (cp.quantifier === '+' || cp.quantifier === '1') {
          // Required child node was not present
          return null;
        }
      }
    }

    // Predicates evaluation
    for (const pred of pattern.predicates) {
      const found = captures.find((c) => c.capture === pred.capture);
      const targetText = found ? found.text : '';

      switch (pred.type) {
        case 'eq':
          if (pred.otherCapture) {
            const otherFound = captures.find((c) => c.capture === pred.otherCapture);
            if (!found || !otherFound || targetText !== otherFound.text) return null;
          } else {
            if (!found || targetText !== pred.value) return null;
          }
          break;

        case 'not-eq':
          if (pred.otherCapture) {
            const otherFound = captures.find((c) => c.capture === pred.otherCapture);
            if (found && otherFound && targetText === otherFound.text) return null;
          } else {
            if (found && targetText === pred.value) return null;
          }
          break;

        case 'match':
          if (!found || !pred.regex || !pred.regex.test(targetText)) return null;
          break;

        case 'not-match':
          if (found && pred.regex && pred.regex.test(targetText)) return null;
          break;

        case 'any-of':
          if (!found || !pred.values || !pred.values.includes(targetText)) return null;
          break;
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
