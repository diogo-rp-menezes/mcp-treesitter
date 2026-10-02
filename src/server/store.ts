import { Project, ProjectFile } from './types';
import { detectLanguage } from './parser';

const projects = new Map<string, Project>();

// Preload demo projects
function initDefaultProjects() {
  const treeSitterProject: Project = {
    name: 'tree-sitter-core',
    path: '/projects/tree-sitter-core',
    description: 'Tree-sitter AST analysis demo repository with Python, TypeScript, Go, and Rust sources',
    files: new Map<string, ProjectFile>(),
  };

  const samplePython = `import os
import sys
from typing import Any, Dict, List, Optional

class TreeSitterAnalyzer:
    """Core code analyzer powered by Tree-sitter AST parsing."""

    def __init__(self, language: str, cache_enabled: bool = True):
        self.language = language
        self.cache_enabled = cache_enabled
        self.node_count = 0

    def parse_source(self, code: str) -> Dict[str, Any]:
        """Parse source code string into an AST dictionary."""
        if not code.strip():
            return {"status": "empty", "nodes": []}

        # Analyze structure
        tree = self._build_ast(code)
        symbols = self.extract_symbols(tree)
        return {
            "language": self.language,
            "symbols": symbols,
            "root_type": tree.get("type", "module")
        }

    def extract_symbols(self, node: Dict[str, Any]) -> List[str]:
        """Extract declared function and class symbols from AST."""
        results = []
        for child in node.get("children", []):
            if child.get("type") in ("function_definition", "class_definition"):
                results.append(child.get("name", "anonymous"))
        return results

    def _build_ast(self, code: str) -> Dict[str, Any]:
        return {"type": "module", "children": []}

def format_report(project_name: str, symbol_count: int) -> str:
    """Format an analysis summary report for CLI output."""
    header = f"Analysis Report for {project_name}"
    divider = "=" * len(header)
    return f"{header}\\n{divider}\\nFound {symbol_count} primary symbols."

if __name__ == "__main__":
    analyzer = TreeSitterAnalyzer("python")
    result = analyzer.parse_source("def hello(): pass")
    print(format_report("DemoProject", len(result["symbols"])))
`;

  const sampleTypeScript = `import { useState, useEffect } from 'react';

export interface ASTNodeView {
  id: string;
  type: string;
  isNamed: boolean;
  field?: string;
  startByte: number;
  endByte: number;
}

export class TreeSitterClient {
  private endpoint: string;

  constructor(endpoint: string = '/api/mcp') {
    this.endpoint = endpoint;
  }

  async runQuery(query: string, code: string): Promise<any> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'run_query',
        arguments: { query, code }
      }
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error('MCP query execution failed: ' + res.statusText);
    }
    return res.json();
  }
}

export function useASTExplorer(initialCode: string) {
  const [code, setCode] = useState<string>(initialCode);
  const [selectedNode, setSelectedNode] = useState<ASTNodeView | null>(null);

  useEffect(() => {
    console.log('Code updated, AST ready for inspection');
  }, [code]);

  return { code, setCode, selectedNode, setSelectedNode };
}
`;

  const sampleGo = `package main

import (
	"context"
	"fmt"
	"sync"
)

type ParserConfig struct {
	MaxDepth int
	Verbose  bool
}

type NodeWalker struct {
	mu     sync.RWMutex
	nodes  []string
	config ParserConfig
}

func NewNodeWalker(cfg ParserConfig) *NodeWalker {
	return &NodeWalker{
		config: cfg,
		nodes:  make([]string, 0),
	}
}

func (nw *NodeWalker) Walk(ctx context.Context, root string) error {
	nw.mu.Lock()
	defer nw.mu.Unlock()

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		nw.nodes = append(nw.nodes, root)
		fmt.Printf("Parsed root AST element: %s\\n", root)
		return nil
	}
}

func main() {
	cfg := ParserConfig{MaxDepth: 10, Verbose: true}
	walker := NewNodeWalker(cfg)
	ctx := context.Background()
	_ = walker.Walk(ctx, "source_file")
}
`;

  const sampleRust = `use std::collections::HashMap;

pub struct QueryMatcher {
    pattern: String,
    captures: HashMap<String, usize>,
}

impl QueryMatcher {
    pub fn new(pattern: &str) -> Self {
        QueryMatcher {
            pattern: pattern.to_string(),
            captures: HashMap::new(),
        }
    }

    pub fn matches(&mut self, node_type: &str) -> bool {
        if node_type == self.pattern {
            *self.captures.entry(node_type.to_string()).or_insert(0) += 1;
            true
        } else {
            false
        }
    }
}

pub fn analyze_syntax_tree(root_type: &str) -> Result<usize, String> {
    let mut matcher = QueryMatcher::new("function_item");
    if matcher.matches(root_type) {
        Ok(1)
    } else {
        Err("No matching function found".to_string())
    }
}
`;

  addFileToProject(treeSitterProject, 'analyzer.py', samplePython);
  addFileToProject(treeSitterProject, 'client.ts', sampleTypeScript);
  addFileToProject(treeSitterProject, 'walker.go', sampleGo);
  addFileToProject(treeSitterProject, 'matcher.rs', sampleRust);

  projects.set(treeSitterProject.name, treeSitterProject);
}

function addFileToProject(project: Project, path: string, content: string): ProjectFile {
  const file: ProjectFile = {
    path,
    language: detectLanguage(path),
    content,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
    lastModified: new Date().toISOString(),
  };
  project.files.set(path, file);
  return file;
}

initDefaultProjects();

export const projectStore = {
  listProjects(): Array<{ name: string; path: string; description?: string; fileCount: number }> {
    return Array.from(projects.values()).map((p) => ({
      name: p.name,
      path: p.path,
      description: p.description,
      fileCount: p.files.size,
    }));
  },

  getProject(name: string): Project | undefined {
    return projects.get(name);
  },

  createProject(name: string, path?: string, description?: string): Project {
    const proj: Project = {
      name,
      path: path || `/projects/${name}`,
      description: description || `Project ${name}`,
      files: new Map(),
    };
    projects.set(name, proj);
    return proj;
  },

  removeProject(name: string): boolean {
    return projects.delete(name);
  },

  listFiles(projectName: string, pattern?: string, extensions?: string[]): string[] {
    const p = projects.get(projectName);
    if (!p) return [];

    let paths = Array.from(p.files.keys());
    if (extensions && extensions.length > 0) {
      paths = paths.filter((path) => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext && extensions.includes(ext);
      });
    }
    if (pattern) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      paths = paths.filter((path) => regex.test(path));
    }
    return paths;
  },

  getFile(projectName: string, filePath: string): ProjectFile | undefined {
    const p = projects.get(projectName);
    return p?.files.get(filePath);
  },

  saveFile(projectName: string, filePath: string, content: string): ProjectFile {
    let p = projects.get(projectName);
    if (!p) {
      p = this.createProject(projectName);
    }
    return addFileToProject(p, filePath, content);
  },

  deleteFile(projectName: string, filePath: string): boolean {
    const p = projects.get(projectName);
    if (!p) return false;
    return p.files.delete(filePath);
  },
};
