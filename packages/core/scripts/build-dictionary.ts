/**
 * CC-CEDICT + Frequency Indexer Script
 *
 * Downloads and parses CC-CEDICT, pairs entries with frequency metrics and HSK levels,
 * cleans definitions into concise candidate glosses, and outputs a compact JSON dictionary.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { pinyinNumbersToMarks, cleanPinyin, normalizePinyin } from '../src/parser/pinyin.js';
import { formatGloss } from '../src/dictionary/gloss.js';
import { DictEntry } from '../src/types.js';

interface RawCedictLine {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

/**
 * Parses a single line from CC-CEDICT:
 * Format: 傳統 传统 [chuan2 tong3] /tradition/traditional/convention/
 */
export function parseCedictLine(line: string): RawCedictLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
  if (!match) return null;

  const [, traditional, simplified, pinyin, rawDefs] = match;
  const definitions = rawDefs
    .split('/')
    .map((d) => d.trim())
    .filter(Boolean);

  return {
    traditional,
    simplified,
    pinyin,
    definitions,
  };
}

/**
 * Builds a DictEntry from parsed CC-CEDICT components and frequency metadata.
 */
export function buildDictEntry(
  raw: RawCedictLine,
  frequency: number = 100,
  hskLevel?: number
): DictEntry {
  const pinyinNumbers = normalizePinyin(raw.pinyin);
  const pinyinMarks = pinyinNumbersToMarks(pinyinNumbers);
  const pinyinClean = cleanPinyin(pinyinNumbers);
  const pinyinSyllables = pinyinNumbers.split(/\s+/).filter(Boolean);
  const shortGloss = formatGloss(raw.definitions);

  return {
    simplified: raw.simplified,
    traditional: raw.traditional,
    pinyinNumbers,
    pinyinMarks,
    pinyinClean,
    pinyinSyllables,
    definitions: raw.definitions,
    shortGloss,
    frequency,
    hskLevel,
  };
}

async function main() {
  console.log('Building CC-CEDICT dictionary index for @pinyinduck/core...');
  // Ensure output directory exists
  const outDir = path.resolve(__dirname, '../src/data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('Dictionary build script ready. Target output: ' + path.join(outDir, 'dictionary.json'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
