import { ASTNode, CodeComplexity } from './types';

export function calculateComplexity(source: string, ast: ASTNode): CodeComplexity {
  const lines = source.split('\n');
  const lineCount = lines.length;

  // Build high-fidelity comment lines mapping from AST to avoid string literal false positives (like URLs)
  const commentLineSet = new Set<number>();
  function collectComments(node: ASTNode) {
    if (node && (node.type === 'comment' || node.type === 'comment_statement')) {
      for (let r = node.startPoint.row; r <= node.endPoint.row; r++) {
        commentLineSet.add(r);
      }
    }
    if (node && node.children) {
      for (const child of node.children) {
        collectComments(child);
      }
    }
  }

  if (ast) {
    collectComments(ast);
  }

  let codeLines = 0;
  let commentLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue; // blank line

    if (ast) {
      // AST mode: 100% precise AST classification
      if (commentLineSet.has(i)) {
        commentLines++;
        // If there's also code on this line (e.g. inline comment), classify it as a code line as well
        // We consider it code if the line has non-comment characters before or after the comment
        const lineWithoutComment = line.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim();
        if (lineWithoutComment.length > 0) {
          codeLines++;
        }
      } else {
        codeLines++;
      }
    } else {
      // Fallback text-heuristic mode when AST is absent
      const isCommentOnly =
        trimmed.startsWith('#') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*');

      if (isCommentOnly) {
        commentLines++;
      } else {
        codeLines++;
        const hasInlineComment =
          (trimmed.includes('#') && !trimmed.startsWith('#')) ||
          (trimmed.includes('//') && !trimmed.startsWith('//') && !trimmed.includes('://'));

        if (hasInlineComment) {
          commentLines++;
        }
      }
    }
  }

  let functionCount = 0;
  let classCount = 0;
  let totalFunctionLines = 0;
  let cyclomaticComplexity = 1; // base complexity

  function countMetrics(node: ASTNode) {
    if (!node) return;

    if (
      node.type === 'function_definition' ||
      node.type === 'function_declaration' ||
      node.type === 'method_declaration' ||
      node.type === 'function_item' ||
      node.type === 'arrow_function'
    ) {
      functionCount++;
      const span = Math.max(1, node.endPoint.row - node.startPoint.row + 1);
      totalFunctionLines += span;
    }

    if (
      node.type === 'class_definition' ||
      node.type === 'class_declaration' ||
      node.type === 'struct_item' ||
      node.type === 'type_spec'
    ) {
      classCount++;
    }

    // Branch nodes that increase cyclomatic complexity
    if (
      node.type === 'if_statement' ||
      node.type === 'elif_clause' ||
      node.type === 'for_statement' ||
      node.type === 'while_statement' ||
      node.type === 'except_clause' ||
      node.type === 'catch_clause' ||
      node.type === 'case_clause' ||
      node.type === 'conditional_expression' ||
      node.type === 'boolean_operator' ||
      node.type === 'binary_expression' && (node.text?.includes('&&') || node.text?.includes('||') || node.text?.includes(' and ') || node.text?.includes(' or '))
    ) {
      cyclomaticComplexity++;
    }

    if (node.children) {
      for (const child of node.children) {
        countMetrics(child);
      }
    }
  }

  if (ast) {
    countMetrics(ast);
  }

  const avgFunctionLines = functionCount > 0 ? Math.round((totalFunctionLines / functionCount) * 10) / 10 : 0;
  const commentRatio = lineCount > 0 ? Math.round((commentLines / lineCount) * 1000) / 1000 : 0;

  return {
    lineCount,
    codeLines,
    commentLines,
    commentRatio,
    functionCount,
    classCount,
    avgFunctionLines,
    cyclomaticComplexity,
  };
}
