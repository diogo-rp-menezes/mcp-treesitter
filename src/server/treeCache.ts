/**
 * AST/Tree-sitter Language-Agnostic Specification - Section 7
 * Tree Caching Strategy with TTL and LRU Eviction
 */

import Parser from 'web-tree-sitter';
import fs from 'fs';
import path from 'path';
import { serverConfig } from './config';

export interface CachedTree {
  tree: Parser.Tree;
  source: Uint8Array;
  timestamp: number;
  byteSize: number;
}

export class TreeCache {
  private enabled: boolean;
  private maxSizeMB: number;
  private ttlSeconds: number;
  private cache = new Map<string, CachedTree>();
  private modifiedSet = new Set<string>();
  private currentSizeBytes: number = 0;

  constructor() {
    const config = serverConfig.getConfig().cache;
    this.enabled = config.enabled;
    this.maxSizeMB = config.max_size_mb;
    this.ttlSeconds = config.ttl_seconds;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.invalidate();
    }
  }

  public setMaxSizeMB(maxSizeMB: number): void {
    this.maxSizeMB = maxSizeMB;
    this.evictIfNeeded(0);
  }

  public setTTLSeconds(ttlSeconds: number): void {
    this.ttlSeconds = ttlSeconds;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private generateKey(filePath: string, language: string): string {
    const absPath = path.resolve(filePath);
    let mtime = 0;
    try {
      if (fs.existsSync(absPath)) {
        mtime = fs.statSync(absPath).mtimeMs;
      }
    } catch {
      // Use 0 if cannot stat
    }
    return `${language}:${absPath}:${mtime}`;
  }

  public get(filePath: string, language: string): CachedTree | null {
    if (!this.enabled) return null;

    const key = this.generateKey(filePath, language);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL expiration
    const now = Date.now();
    if (now - entry.timestamp > this.ttlSeconds * 1000) {
      this.cache.delete(key);
      this.currentSizeBytes -= entry.byteSize;
      if (entry.tree && typeof entry.tree.delete === 'function') {
        try {
          entry.tree.delete();
        } catch {}
      }
      return null;
    }

    // Refresh LRU position (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  public put(filePath: string, language: string, tree: Parser.Tree, source: Uint8Array): void {
    if (!this.enabled) return;

    const key = this.generateKey(filePath, language);
    const byteSize = source.byteLength || 1024;

    this.evictIfNeeded(byteSize);

    // If key already existed, remove previous size
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSizeBytes -= existing.byteSize;
      if (existing.tree && typeof existing.tree.delete === 'function') {
        try {
          existing.tree.delete();
        } catch {}
      }
    }

    const entry: CachedTree = {
      tree,
      source,
      timestamp: Date.now(),
      byteSize,
    };

    this.cache.set(key, entry);
    this.currentSizeBytes += byteSize;
    this.modifiedSet.delete(key);
  }

  public updateTree(filePath: string, language: string, tree: Parser.Tree, source: Uint8Array): void {
    this.put(filePath, language, tree, source);
  }

  public invalidate(filePath?: string): void {
    if (!filePath) {
      // Clear all
      for (const entry of this.cache.values()) {
        if (entry.tree && typeof entry.tree.delete === 'function') {
          try {
            entry.tree.delete();
          } catch {}
        }
      }
      this.cache.clear();
      this.currentSizeBytes = 0;
      this.modifiedSet.clear();
      return;
    }

    const absPath = path.resolve(filePath);
    for (const [key, entry] of this.cache.entries()) {
      if (key.includes(absPath)) {
        this.cache.delete(key);
        this.currentSizeBytes -= entry.byteSize;
        if (entry.tree && typeof entry.tree.delete === 'function') {
          try {
            entry.tree.delete();
          } catch {}
        }
      }
    }
  }

  public markModified(filePath: string, language: string): void {
    const key = this.generateKey(filePath, language);
    this.modifiedSet.add(key);
  }

  public isModified(filePath: string, language: string): boolean {
    const key = this.generateKey(filePath, language);
    return this.modifiedSet.has(key);
  }

  private evictIfNeeded(incomingBytes: number): void {
    const maxBytes = this.maxSizeMB * 1024 * 1024;
    const threshold = maxBytes * 0.9;

    if (this.currentSizeBytes + incomingBytes > maxBytes || this.currentSizeBytes > threshold) {
      // Evict oldest entries until below 70%
      const targetSize = maxBytes * 0.7;
      for (const [key, entry] of this.cache.entries()) {
        if (this.currentSizeBytes + incomingBytes <= targetSize && this.cache.size <= 1) {
          break;
        }
        this.cache.delete(key);
        this.currentSizeBytes -= entry.byteSize;
        if (entry.tree && typeof entry.tree.delete === 'function') {
          try {
            entry.tree.delete();
          } catch {}
        }
      }
    }
  }

  public getStats() {
    return {
      enabled: this.enabled,
      entriesCount: this.cache.size,
      currentSizeMB: (this.currentSizeBytes / (1024 * 1024)).toFixed(2),
      maxSizeMB: this.maxSizeMB,
      ttlSeconds: this.ttlSeconds,
    };
  }
}

export const treeCache = new TreeCache();
