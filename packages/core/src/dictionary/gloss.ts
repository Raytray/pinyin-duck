/**
 * Utilities for cleaning and formatting dictionary definitions into
 * concise, readable candidate card glosses for language learners.
 */

/**
 * Cleans a list of raw CC-CEDICT definition lines and produces a crisp, readable gloss.
 *
 * Example input: ["hello", "how are you"]
 * Example output: "hello / how are you"
 */
export function formatGloss(rawDefs: string[], maxLength: number = 65): string {
  if (!rawDefs || rawDefs.length === 0) return '';

  const cleanedDefs: string[] = [];

  for (const def of rawDefs) {
    const trimmed = def.trim();
    if (!trimmed) continue;

    // Filter out classifier annotations (e.g. "CL:個|个[ge4]")
    if (/^CL:/i.test(trimmed)) continue;

    // Filter out archaic / cross reference indicators if we have other meanings
    if (/^(variant of|see also|same as|archaic variant of)/i.test(trimmed) && cleanedDefs.length > 0) {
      continue;
    }

    // Strip internal pronunciation bracket tags like "[ge4]" or "[tai2]"
    const sanitized = trimmed
      .replace(/\[[a-z0-9\s:,'’]+\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (sanitized && !cleanedDefs.includes(sanitized)) {
      cleanedDefs.push(sanitized);
    }

    if (cleanedDefs.length >= 3) break;
  }

  if (cleanedDefs.length === 0) {
    // If everything was filtered out, fallback to first non-empty raw definition
    const fallback = rawDefs[0]?.trim() || '';
    return truncate(fallback, maxLength);
  }

  const combined = cleanedDefs.join(' / ');
  return truncate(combined, maxLength);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + '…';
}
