import { ASTNode, ASTPosition, SymbolItem } from './types';

let nodeIdCounter = 0;
function nextNodeId(): string {
  return `node_${++nodeIdCounter}`;
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    py: 'python',
    pyi: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    dart: 'dart',
    jl: 'julia',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    html: 'html',
    md: 'markdown',
  };
  return map[ext] || 'python';
}

function calculateByteOffsets(source: string): { lineStarts: number[] } {
  const lines = source.split('\n');
  const lineStarts: number[] = [0];
  let cur = 0;
  for (let i = 0; i < lines.length; i++) {
    cur += lines[i].length + 1; // +1 for \n
    lineStarts.push(cur);
  }
  return { lineStarts };
}

export function parseSourceToAST(source: string, language: string = 'python'): ASTNode {
  const { lineStarts } = calculateByteOffsets(source);
  const lines = source.split('\n');

  function getOffset(pos: ASTPosition): number {
    const lineStart = lineStarts[pos.row] ?? 0;
    return Math.min(source.length, lineStart + pos.column);
  }

  function makeNode(
    type: string,
    isNamed: boolean,
    start: ASTPosition,
    end: ASTPosition,
    children: ASTNode[] = [],
    field?: string
  ): ASTNode {
    const startByte = getOffset(start);
    const endByte = getOffset(end);
    const text = source.slice(startByte, endByte);
    return {
      id: nextNodeId(),
      type,
      isNamed,
      field,
      startPoint: start,
      endPoint: end,
      startByte,
      endByte,
      text,
      children,
    };
  }

  const rootType = language === 'python' ? 'module' : language === 'rust' || language === 'go' ? 'source_file' : 'program';
  const totalRows = lines.length;
  const lastRowLen = lines[totalRows - 1]?.length || 0;
  const rootStart: ASTPosition = { row: 0, column: 0 };
  const rootEnd: ASTPosition = { row: Math.max(0, totalRows - 1), column: lastRowLen };

  if (language === 'python') {
    return parsePython(source, lines, rootStart, rootEnd, makeNode);
  } else if (language === 'javascript' || language === 'typescript') {
    return parseJsTs(source, lines, language, rootStart, rootEnd, makeNode);
  } else if (language === 'go') {
    return parseGo(source, lines, rootStart, rootEnd, makeNode);
  } else if (language === 'rust') {
    return parseRust(source, lines, rootStart, rootEnd, makeNode);
  }

  // Generic fallback for any language
  return parseGeneric(source, lines, rootType, rootStart, rootEnd, makeNode);
}

function parsePython(
  source: string,
  lines: string[],
  rootStart: ASTPosition,
  rootEnd: ASTPosition,
  makeNode: (type: string, isNamed: boolean, s: ASTPosition, e: ASTPosition, children?: ASTNode[], field?: string) => ASTNode
): ASTNode {
  const rootChildren: ASTNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const colIndent = line.search(/\S/);

    if (trimmed.startsWith('#')) {
      const commentNode = makeNode('comment', false, { row: i, column: colIndent }, { row: i, column: line.length });
      rootChildren.push(commentNode);
      i++;
      continue;
    }

    // Function definition
    if (/^(async\s+)?def\s+/.test(trimmed)) {
      const funcMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*->\s*([^:]+))?:/);
      const funcStartRow = i;
      const funcName = funcMatch ? funcMatch[1] : 'func';
      const rawParams = funcMatch ? funcMatch[2] : '';

      // Find block extent by indentation
      let endRow = i;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed === '') {
          j++;
          continue;
        }
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= colIndent) break;
        endRow = j;
        j++;
      }
      i = j;

      const nameCol = line.indexOf(funcName);
      const nameNode = makeNode('identifier', true, { row: funcStartRow, column: nameCol }, { row: funcStartRow, column: nameCol + funcName.length }, [], 'name');

      // Parameters
      const paramStartCol = line.indexOf('(');
      const paramEndCol = line.indexOf(')');
      const paramChildren: ASTNode[] = [];
      if (rawParams.trim()) {
        const parts = rawParams.split(',').map((p) => p.trim());
        for (const p of parts) {
          const pName = p.split(':')[0].trim().split('=')[0].trim();
          const pCol = line.indexOf(pName, paramStartCol);
          if (pCol !== -1) {
            paramChildren.push(makeNode('identifier', true, { row: funcStartRow, column: pCol }, { row: funcStartRow, column: pCol + pName.length }));
          }
        }
      }
      const paramsNode = makeNode(
        'parameters',
        true,
        { row: funcStartRow, column: Math.max(0, paramStartCol) },
        { row: funcStartRow, column: Math.max(paramStartCol + 1, paramEndCol + 1) },
        paramChildren,
        'parameters'
      );

      // Block statements
      const blockChildren: ASTNode[] = [];
      for (let r = funcStartRow + 1; r <= endRow; r++) {
        const bl = lines[r];
        const bt = bl.trim();
        if (!bt) continue;
        const bIndent = bl.search(/\S/);
        if (bt.startsWith('#')) {
          blockChildren.push(makeNode('comment', false, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (/^if[\s(]/.test(bt)) {
          blockChildren.push(makeNode('if_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (/^elif[\s(]/.test(bt)) {
          blockChildren.push(makeNode('elif_clause', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (bt.startsWith('else:')) {
          blockChildren.push(makeNode('else_clause', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (/^for[\s(]/.test(bt)) {
          blockChildren.push(makeNode('for_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (/^while[\s(]/.test(bt)) {
          blockChildren.push(makeNode('while_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (bt.startsWith('return')) {
          blockChildren.push(makeNode('return_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        } else if (bt.includes('(') && bt.includes(')')) {
          const callMatch = bt.match(/([a-zA-Z0-9_]+)\s*\(/);
          if (callMatch) {
            const cName = callMatch[1];
            const cCol = bl.indexOf(cName);
            const fnNode = makeNode('identifier', true, { row: r, column: cCol }, { row: r, column: cCol + cName.length }, [], 'function');
            const argsNode = makeNode('argument_list', true, { row: r, column: cCol + cName.length }, { row: r, column: bl.length }, [], 'arguments');
            blockChildren.push(makeNode('call', true, { row: r, column: bIndent }, { row: r, column: bl.length }, [fnNode, argsNode]));
          } else {
            blockChildren.push(makeNode('expression_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
          }
        } else {
          blockChildren.push(makeNode('expression_statement', true, { row: r, column: bIndent }, { row: r, column: bl.length }));
        }
      }

      const blockNode = makeNode('block', true, { row: funcStartRow + 1, column: 0 }, { row: endRow, column: lines[endRow]?.length || 0 }, blockChildren, 'body');

      const funcNode = makeNode(
        'function_definition',
        true,
        { row: funcStartRow, column: colIndent },
        { row: endRow, column: lines[endRow]?.length || 0 },
        [nameNode, paramsNode, blockNode]
      );
      rootChildren.push(funcNode);
      continue;
    }

    // Class definition
    if (/^class\s+/.test(trimmed)) {
      const clsMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\((.*?)\))?:/);
      const clsStartRow = i;
      const clsName = clsMatch ? clsMatch[1] : 'Cls';
      let endRow = i;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') {
          j++;
          continue;
        }
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= colIndent) break;
        endRow = j;
        j++;
      }
      i = j;

      const nameCol = line.indexOf(clsName);
      const nameNode = makeNode('identifier', true, { row: clsStartRow, column: nameCol }, { row: clsStartRow, column: nameCol + clsName.length }, [], 'name');

      const clsChildren: ASTNode[] = [nameNode];
      if (clsMatch && clsMatch[2]) {
        const supCol = line.indexOf('(');
        const supEnd = line.indexOf(')');
        clsChildren.push(makeNode('argument_list', true, { row: clsStartRow, column: supCol }, { row: clsStartRow, column: supEnd + 1 }, [], 'superclasses'));
      }

      // Class block
      const blockNode = makeNode('block', true, { row: clsStartRow + 1, column: 0 }, { row: endRow, column: lines[endRow]?.length || 0 }, [], 'body');
      clsChildren.push(blockNode);

      const classNode = makeNode('class_definition', true, { row: clsStartRow, column: colIndent }, { row: endRow, column: lines[endRow]?.length || 0 }, clsChildren);
      rootChildren.push(classNode);
      continue;
    }

    // Import statement
    if (/^(import\s+|from\s+)/.test(trimmed)) {
      const isFrom = trimmed.startsWith('from ');
      const impType = isFrom ? 'import_from_statement' : 'import_statement';
      const impNode = makeNode(impType, true, { row: i, column: colIndent }, { row: i, column: line.length });
      rootChildren.push(impNode);
      i++;
      continue;
    }

    // Default statement / expression
    rootChildren.push(makeNode('expression_statement', true, { row: i, column: colIndent }, { row: i, column: line.length }));
    i++;
  }

  return makeNode('module', true, rootStart, rootEnd, rootChildren);
}

function parseJsTs(
  source: string,
  lines: string[],
  language: string,
  rootStart: ASTPosition,
  rootEnd: ASTPosition,
  makeNode: (type: string, isNamed: boolean, s: ASTPosition, e: ASTPosition, children?: ASTNode[], field?: string) => ASTNode
): ASTNode {
  const rootChildren: ASTNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colIndent = line.search(/\S/);

    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      rootChildren.push(makeNode('comment', false, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }

    if (/^import\s+/.test(trimmed)) {
      const clauseCol = line.indexOf('import') + 6;
      const clauseNode = makeNode('import_clause', true, { row: i, column: clauseCol }, { row: i, column: line.length }, [], 'clause');
      rootChildren.push(makeNode('import_statement', true, { row: i, column: colIndent }, { row: i, column: line.length }, [clauseNode]));
      continue;
    }

    if (/^(export\s+)?(default\s+)?(async\s+)?function\s+/.test(trimmed)) {
      const fnMatch = trimmed.match(/function\s+([a-zA-Z0-9_$]+)?\s*\((.*?)\)/);
      const name = fnMatch?.[1] || 'anonymous';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('identifier', true, { row: i, column: Math.max(0, nameCol) }, { row: i, column: Math.max(0, nameCol) + name.length }, [], 'name');
      const paramNode = makeNode('formal_parameters', true, { row: i, column: line.indexOf('(') }, { row: i, column: line.indexOf(')') + 1 }, [], 'parameters');
      const bodyNode = makeNode('statement_block', true, { row: i, column: line.indexOf('{') }, { row: i, column: line.length }, [], 'body');
      rootChildren.push(makeNode('function_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, paramNode, bodyNode]));
      continue;
    }

    if (/^(export\s+)?class\s+/.test(trimmed)) {
      const clsMatch = trimmed.match(/class\s+([a-zA-Z0-9_$]+)/);
      const name = clsMatch?.[1] || 'Cls';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode(language === 'typescript' ? 'type_identifier' : 'identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      const bodyNode = makeNode('class_body', true, { row: i, column: line.indexOf('{') }, { row: i, column: line.length }, [], 'body');
      rootChildren.push(makeNode('class_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, bodyNode]));
      continue;
    }

    if (language === 'typescript' && /^(export\s+)?interface\s+/.test(trimmed)) {
      const ifMatch = trimmed.match(/interface\s+([a-zA-Z0-9_$]+)/);
      const name = ifMatch?.[1] || 'Iface';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('type_identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      const bodyNode = makeNode('interface_body', true, { row: i, column: line.indexOf('{') }, { row: i, column: line.length }, [], 'body');
      rootChildren.push(makeNode('interface_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, bodyNode]));
      continue;
    }

    if (trimmed.includes('(') && trimmed.includes(')')) {
      const callMatch = trimmed.match(/([a-zA-Z0-9_$]+)\s*\(/);
      if (callMatch) {
        const cName = callMatch[1];
        const cCol = line.indexOf(cName);
        const fnNode = makeNode('identifier', true, { row: i, column: cCol }, { row: i, column: cCol + cName.length }, [], 'function');
        const argsNode = makeNode('arguments', true, { row: i, column: cCol + cName.length }, { row: i, column: line.length }, [], 'arguments');
        rootChildren.push(makeNode('call_expression', true, { row: i, column: colIndent }, { row: i, column: line.length }, [fnNode, argsNode]));
        continue;
      }
    }

    rootChildren.push(makeNode('statement', true, { row: i, column: colIndent }, { row: i, column: line.length }));
  }

  return makeNode('program', true, rootStart, rootEnd, rootChildren);
}

function parseGo(
  source: string,
  lines: string[],
  rootStart: ASTPosition,
  rootEnd: ASTPosition,
  makeNode: (type: string, isNamed: boolean, s: ASTPosition, e: ASTPosition, children?: ASTNode[], field?: string) => ASTNode
): ASTNode {
  const rootChildren: ASTNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colIndent = line.search(/\S/);

    if (trimmed.startsWith('//')) {
      rootChildren.push(makeNode('comment', false, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }
    if (trimmed.startsWith('package ')) {
      rootChildren.push(makeNode('package_clause', true, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }
    if (trimmed.startsWith('import ')) {
      rootChildren.push(makeNode('import_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }
    if (trimmed.startsWith('func ')) {
      const fnMatch = trimmed.match(/func\s+([a-zA-Z0-9_]+)\s*\(/);
      const name = fnMatch?.[1] || 'fn';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      const paramsNode = makeNode('parameter_list', true, { row: i, column: line.indexOf('(') }, { row: i, column: line.indexOf(')') + 1 }, [], 'parameters');
      const bodyNode = makeNode('block', true, { row: i, column: line.indexOf('{') }, { row: i, column: line.length }, [], 'body');
      rootChildren.push(makeNode('function_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, paramsNode, bodyNode]));
      continue;
    }
    if (trimmed.startsWith('type ')) {
      const typeMatch = trimmed.match(/type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/);
      const name = typeMatch?.[1] || 'Type';
      const kind = typeMatch?.[2] === 'struct' ? 'struct_type' : 'interface_type';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('type_identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      const kindNode = makeNode(kind, true, { row: i, column: line.indexOf(typeMatch?.[2] || 'struct') }, { row: i, column: line.length });
      rootChildren.push(makeNode('type_spec', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, kindNode]));
      continue;
    }
    rootChildren.push(makeNode('statement', true, { row: i, column: colIndent }, { row: i, column: line.length }));
  }
  return makeNode('source_file', true, rootStart, rootEnd, rootChildren);
}

function parseRust(
  source: string,
  lines: string[],
  rootStart: ASTPosition,
  rootEnd: ASTPosition,
  makeNode: (type: string, isNamed: boolean, s: ASTPosition, e: ASTPosition, children?: ASTNode[], field?: string) => ASTNode
): ASTNode {
  const rootChildren: ASTNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colIndent = line.search(/\S/);

    if (trimmed.startsWith('//')) {
      rootChildren.push(makeNode('line_comment', false, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }
    if (/^(pub\s+)?fn\s+/.test(trimmed)) {
      const fnMatch = trimmed.match(/fn\s+([a-zA-Z0-9_]+)\s*\(/);
      const name = fnMatch?.[1] || 'fn';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      const paramsNode = makeNode('parameters', true, { row: i, column: line.indexOf('(') }, { row: i, column: line.indexOf(')') + 1 }, [], 'parameters');
      const bodyNode = makeNode('block', true, { row: i, column: line.indexOf('{') }, { row: i, column: line.length }, [], 'body');
      rootChildren.push(makeNode('function_item', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode, paramsNode, bodyNode]));
      continue;
    }
    if (/^(pub\s+)?struct\s+/.test(trimmed)) {
      const stMatch = trimmed.match(/struct\s+([a-zA-Z0-9_]+)/);
      const name = stMatch?.[1] || 'Struct';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('type_identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      rootChildren.push(makeNode('struct_item', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode]));
      continue;
    }
    if (/^(pub\s+)?enum\s+/.test(trimmed)) {
      const enMatch = trimmed.match(/enum\s+([a-zA-Z0-9_]+)/);
      const name = enMatch?.[1] || 'Enum';
      const nameCol = line.indexOf(name);
      const nameNode = makeNode('type_identifier', true, { row: i, column: nameCol }, { row: i, column: nameCol + name.length }, [], 'name');
      rootChildren.push(makeNode('enum_item', true, { row: i, column: colIndent }, { row: i, column: line.length }, [nameNode]));
      continue;
    }
    if (trimmed.startsWith('use ')) {
      rootChildren.push(makeNode('use_declaration', true, { row: i, column: colIndent }, { row: i, column: line.length }));
      continue;
    }
    rootChildren.push(makeNode('statement', true, { row: i, column: colIndent }, { row: i, column: line.length }));
  }
  return makeNode('source_file', true, rootStart, rootEnd, rootChildren);
}

function parseGeneric(
  source: string,
  lines: string[],
  rootType: string,
  rootStart: ASTPosition,
  rootEnd: ASTPosition,
  makeNode: (type: string, isNamed: boolean, s: ASTPosition, e: ASTPosition, children?: ASTNode[], field?: string) => ASTNode
): ASTNode {
  const rootChildren: ASTNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colIndent = line.search(/\S/);

    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      rootChildren.push(makeNode('comment', false, { row: i, column: colIndent }, { row: i, column: line.length }));
    } else {
      rootChildren.push(makeNode('line_item', true, { row: i, column: colIndent }, { row: i, column: line.length }));
    }
  }
  return makeNode(rootType, true, rootStart, rootEnd, rootChildren);
}

export function findNodeAtPosition(root: ASTNode, row: number, column: number): ASTNode | null {
  function contains(node: ASTNode): boolean {
    if (row < node.startPoint.row || row > node.endPoint.row) return false;
    if (row === node.startPoint.row && column < node.startPoint.column) return false;
    if (row === node.endPoint.row && column > node.endPoint.column) return false;
    return true;
  }

  if (!contains(root)) return null;

  let current: ASTNode = root;
  let matched = true;

  while (matched) {
    matched = false;
    for (const child of current.children) {
      if (contains(child)) {
        current = child;
        matched = true;
        break;
      }
    }
  }

  return current;
}

export function extractSymbolsFromAST(root: ASTNode, language: string): Record<string, SymbolItem[]> {
  const symbols: Record<string, SymbolItem[]> = {
    functions: [],
    classes: [],
    imports: [],
    interfaces: [],
    variables: [],
  };

  function traverse(node: ASTNode, parentName?: string) {
    if (
      node.type === 'function_definition' ||
      node.type === 'function_declaration' ||
      node.type === 'method_declaration' ||
      node.type === 'function_item' ||
      node.type === 'arrow_function'
    ) {
      const nameNode = node.children.find((c) => c.field === 'name' || c.type === 'identifier');
      const name = nameNode?.text || 'anonymous';
      const paramsNode = node.children.find((c) => c.field === 'parameters' || c.type.includes('param'));
      const signature = paramsNode?.text || '()';

      symbols.functions.push({
        name,
        type: node.type.includes('method') ? 'method' : 'function',
        signature: `${name}${signature}`,
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
        parent: parentName,
      });

      for (const child of node.children) {
        traverse(child, name);
      }
      return;
    }

    if (
      node.type === 'class_definition' ||
      node.type === 'class_declaration' ||
      node.type === 'struct_item' ||
      node.type === 'type_spec'
    ) {
      const nameNode = node.children.find((c) => c.field === 'name' || c.type === 'identifier' || c.type === 'type_identifier');
      const name = nameNode?.text || 'Class';

      symbols.classes.push({
        name,
        type: 'class',
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
        parent: parentName,
      });

      for (const child of node.children) {
        traverse(child, name);
      }
      return;
    }

    if (node.type === 'interface_declaration') {
      const nameNode = node.children.find((c) => c.field === 'name' || c.type.includes('identifier'));
      const name = nameNode?.text || 'Interface';
      symbols.interfaces.push({
        name,
        type: 'interface',
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
      });
      return;
    }

    if (
      node.type === 'import_statement' ||
      node.type === 'import_from_statement' ||
      node.type === 'import_declaration' ||
      node.type === 'use_declaration'
    ) {
      symbols.imports.push({
        name: node.text?.trim() || 'import',
        type: 'import',
        startLine: node.startPoint.row,
        endLine: node.endPoint.row,
        startColumn: node.startPoint.column,
        endColumn: node.endPoint.column,
      });
      return;
    }

    for (const child of node.children) {
      traverse(child, parentName);
    }
  }

  traverse(root);
  return symbols;
}
