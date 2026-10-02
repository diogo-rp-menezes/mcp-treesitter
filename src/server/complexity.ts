import { ASTNode, CodeComplexity } from './types';

export function calculateComplexity(source: string, ast: ASTNode): CodeComplexity {
  const lines = source.split('\n');
  const lineCount = lines.length;

  let codeLines = 0;
  let commentLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      commentLines++;
    } else {
      codeLines++;
      if (trimmed.includes('#') || trimmed.includes('//')) {
        commentLines++;
      }
    }
  }

  let functionCount = 0;
  let classCount = 0;
  let totalFunctionLines = 0;
  let cyclomaticComplexity = 1; // base complexity

  function countMetrics(node: ASTNode) {
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
      node.type === 'binary_expression' && (node.text?.includes('&&') || node.text?.includes('||'))
    ) {
      cyclomaticComplexity++;
    }

    for (const child of node.children) {
      countMetrics(child);
    }
  }

  countMetrics(ast);

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
