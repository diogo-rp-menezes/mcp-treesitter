import { describe, it, expect } from 'vitest';
import { calculateComplexity } from '../complexity';
import { parseSourceToAST } from '../parser';

describe('Code Complexity Calculator', () => {
  it('calculates lines, comments, and cyclomatic complexity', () => {
    const code = `# Header comment
def process(x):
    # Check threshold
    if x > 10:
        return True
    elif x < 0:
        return False
    return None
`;
    const ast = parseSourceToAST(code, 'python');
    const metrics = calculateComplexity(code, ast);

    expect(metrics.lineCount).toBe(9);
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(6);
    expect(metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(3);
  });

  it('measures complexity for simple functions with base score 1', () => {
    const code = `def simple():\n    return 42\n`;
    const ast = parseSourceToAST(code, 'python');
    const metrics = calculateComplexity(code, ast);

    expect(metrics.cyclomaticComplexity).toBe(1);
    expect(metrics.functionCount).toBe(1);
  });

  it('excludes string literals and protocol URLs from comment counts', () => {
    const code = `url = "https://google.com"\nmsg = "This is a # hashtag inside a string"\n`;
    const ast = parseSourceToAST(code, 'python');
    const metrics = calculateComplexity(code, ast);

    expect(metrics.commentLines).toBe(0);
    expect(metrics.codeLines).toBe(2);
  });
});
