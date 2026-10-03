import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  parseSourceToAST,
  extractSymbolsFromAST,
  findNodeAtPosition,
} from '../parser';

describe('Tree-sitter Parser Engine', () => {
  it('detects programming languages accurately from file extensions', () => {
    expect(detectLanguage('main.py')).toBe('python');
    expect(detectLanguage('index.ts')).toBe('typescript');
    expect(detectLanguage('App.tsx')).toBe('typescript');
    expect(detectLanguage('server.js')).toBe('javascript');
    expect(detectLanguage('lib.rs')).toBe('rust');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('unknown.xyz')).toBe('python');
  });

  it('parses Python source code into structured AST nodes', () => {
    const code = `def calculate(a, b):\n    return a + b\n\nclass Calculator:\n    pass\n`;
    const ast = parseSourceToAST(code, 'python');

    expect(ast.type).toBe('module');
    expect(ast.children.length).toBeGreaterThan(0);

    const funcNode = ast.children.find((c) => c.type === 'function_definition');
    expect(funcNode).toBeDefined();
    expect(funcNode?.text).toContain('def calculate');

    const classNode = ast.children.find((c) => c.type === 'class_definition');
    expect(classNode).toBeDefined();
    expect(classNode?.text).toContain('class Calculator');
  });

  it('extracts declared symbols from AST', () => {
    const code = `def foo():\n    pass\n\ndef bar():\n    pass\n\nclass MyService:\n    pass\n`;
    const ast = parseSourceToAST(code, 'python');
    const symbols = extractSymbolsFromAST(ast, 'python');

    expect(symbols.functions).toBeDefined();
    expect(symbols.functions.length).toBe(2);
    expect(symbols.classes).toBeDefined();
    expect(symbols.classes.length).toBe(1);
    expect(symbols.classes[0].name).toBe('MyService');
  });

  it('locates specific AST node at coordinates', () => {
    const code = `x = 10\ndef run():\n    return x\n`;
    const ast = parseSourceToAST(code, 'python');

    const node = findNodeAtPosition(ast, 1, 4); // coordinate inside identifier "run"
    expect(node).not.toBeNull();
    expect(node?.type).toBe('identifier');
    expect(node?.text).toBe('run');
  });

  it('parses C#, Java and JSON into rich AST nodes', () => {
    // C#
    const csCode = `public class Program {\n    public void Run() {}\n}`;
    const csAst = parseSourceToAST(csCode, 'csharp');
    expect(csAst.type).toBe('compilation_unit');
    expect(csAst.children.some((c) => c.type === 'class_declaration')).toBe(true);

    // Java
    const javaCode = `package com.app;\npublic class Service {\n    public int calc() { return 1; }\n}`;
    const javaAst = parseSourceToAST(javaCode, 'java');
    expect(javaAst.children.some((c) => c.type === 'package_declaration')).toBe(true);
    expect(javaAst.children.some((c) => c.type === 'class_declaration')).toBe(true);

    // JSON
    const jsonCode = `{"name": "test", "version": 1}`;
    const jsonAst = parseSourceToAST(jsonCode, 'json');
    expect(jsonAst.type).toBe('document');
    expect(jsonAst.children.some((c) => c.type === 'pair')).toBe(true);
  });
});
