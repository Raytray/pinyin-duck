import { DictEntry } from '../types.js';

export interface TrieNode {
  children: Map<string, TrieNode>;
  entries: DictEntry[];
}

export class PinyinTrie {
  private root: TrieNode = {
    children: new Map(),
    entries: [],
  };

  /**
   * Inserts a dictionary entry indexed by a pinyin key (e.g. "nihao" or "ni").
   */
  public insert(key: string, entry: DictEntry): void {
    const cleanKey = key.toLowerCase();
    let current = this.root;

    for (let i = 0; i < cleanKey.length; i++) {
      const char = cleanKey[i];
      let next = current.children.get(char);
      if (!next) {
        next = {
          children: new Map(),
          entries: [],
        };
        current.children.set(char, next);
      }
      current = next;
    }

    current.entries.push(entry);
  }

  /**
   * Exact search for a pinyin string.
   */
  public searchExact(key: string): DictEntry[] {
    const cleanKey = key.toLowerCase();
    let current = this.root;

    for (let i = 0; i < cleanKey.length; i++) {
      const next = current.children.get(cleanKey[i]);
      if (!next) return [];
      current = next;
    }

    return current.entries;
  }

  /**
   * Prefix search returning all entries whose pinyin starts with the given prefix.
   */
  public searchPrefix(prefix: string, maxResults: number = 200): DictEntry[] {
    const cleanPrefix = prefix.toLowerCase();
    let current = this.root;

    for (let i = 0; i < cleanPrefix.length; i++) {
      const next = current.children.get(cleanPrefix[i]);
      if (!next) return [];
      current = next;
    }

    const results: DictEntry[] = [];
    this.collectAll(current, results, maxResults);
    return results;
  }

  private collectAll(node: TrieNode, results: DictEntry[], maxResults: number): void {
    if (results.length >= maxResults) return;

    for (const entry of node.entries) {
      results.push(entry);
      if (results.length >= maxResults) return;
    }

    for (const child of node.children.values()) {
      this.collectAll(child, results, maxResults);
      if (results.length >= maxResults) return;
    }
  }
}
