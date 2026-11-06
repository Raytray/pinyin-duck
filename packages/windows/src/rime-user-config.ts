/**
 * Merges the PinyinDuck patch into a user's existing `default.custom.yaml`.
 *
 * Rime has one `default.custom.yaml` per user folder, and it is where the scheme list
 * lives, so anyone who already customizes Rime has one. Copying ours over it replaces
 * their scheme list, hotkeys and anything else they patched. This module adds what
 * PinyinDuck needs to the file they already have, and leaves the rest of it alone.
 *
 * Rime patches a list in one of three ways, and a user's file can use any of them:
 *
 *   patch:
 *     schema_list: [...]            replaces the list
 *     schema_list/+: [...]          appends to the list
 *     switcher: { save_options: [...] }   replaces the parent map, list included
 *
 * PinyinDuck's items are appended to whichever of those the file already uses, so they
 * take effect the same way the user's own entries do. A file that patches none of them
 * gets the append form, which keeps the schemes Rime ships.
 *
 * Parsing uses `yaml`'s document API rather than a plain object round trip, so the
 * user's comments, quoting and key order survive the merge.
 */

import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';

/** A list PinyinDuck adds to, and the items it adds. */
interface ListPatch {
  /** The list's path below `patch:`, in Rime's slash form. */
  path: string;
  /** The items to add, as plain values. */
  items: unknown[];
  /** The value an item is identified by, so an entry already present is not added twice. */
  identity: (item: unknown) => string | undefined;
}

export class RimeUserConfigError extends Error {}

export interface MergeResult {
  /** The file to write. Byte-identical to the input when nothing had to be added. */
  content: string;
  /** False when the existing file already had everything, so there is nothing to write. */
  changed: boolean;
  /** What was added, as `path: identity` pairs, for the installer to report. */
  added: string[];
}

/** `{ schema: x }` is identified by `x`; a plain scalar such as `ascii_mode` by itself. */
function identityOf(item: unknown): string | undefined {
  if (isScalar(item)) return identityOf(item.value);
  if (isMap(item)) {
    const schema = item.get('schema');
    return schema === undefined ? undefined : `schema:${String(schema)}`;
  }
  if (item !== null && typeof item === 'object' && 'schema' in item) {
    return `schema:${String((item as { schema: unknown }).schema)}`;
  }
  return item === null || item === undefined ? undefined : String(item);
}

/** Reads the patches out of our own shipped `default.custom.yaml`. */
function ourListPatches(ours: string): ListPatch[] {
  const doc = parseStrict(ours, 'the PinyinDuck default.custom.yaml');
  const patch = doc.get('patch');
  if (!isMap(patch)) {
    throw new RimeUserConfigError('The PinyinDuck default.custom.yaml has no patch: map.');
  }
  return patch.items.map((pair) => {
    const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
    if (!key.endsWith('/+') || !isSeq(pair.value)) {
      // Only appends can be merged without overriding something the user chose.
      throw new RimeUserConfigError(
        `The PinyinDuck default.custom.yaml patches ${key} in a form that cannot be merged; ` +
          'every entry must append to a list with "/+".'
      );
    }
    return {
      path: key.slice(0, -'/+'.length),
      items: (pair.value.toJSON() as unknown[]),
      identity: identityOf,
    };
  });
}

function parseStrict(text: string, what: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new RimeUserConfigError(`Could not parse ${what}: ${doc.errors[0].message}`);
  }
  return doc;
}

/**
 * Finds the list the user's patch already uses for `path`, in Rime's order of effect.
 *
 * A replacement (`schema_list:`) wins over an append, since appending next to a
 * replacement would be applied after it anyway and splits the user's list in two. The
 * nested form (`switcher: { save_options: }`) is a replacement of the parent map, so the
 * list inside it is what Rime will end up with.
 */
function findUserList(patch: YAMLMap, path: string): YAMLSeq | undefined {
  for (const key of [path, `${path}/+`]) {
    const value = patch.get(key, true);
    if (isSeq(value)) return value;
    if (value !== undefined) {
      throw new RimeUserConfigError(`patch/${key} in your default.custom.yaml is not a list.`);
    }
  }
  const segments = path.split('/');
  if (segments.length > 1) {
    const nested = patch.getIn(segments, true);
    if (isSeq(nested)) return nested;
    if (nested !== undefined) {
      throw new RimeUserConfigError(`patch/${segments.join('/')} in your default.custom.yaml is not a list.`);
    }
  }
  return undefined;
}

/**
 * Adds PinyinDuck's patch to `existing`, or returns `ours` when there is no file yet.
 *
 * Throws `RimeUserConfigError` when the existing file cannot be merged safely: it is not
 * valid YAML, its `patch` is not a map, or a list it patches is not a list. The installer
 * then leaves the file alone and says what to add by hand.
 */
export function mergeDefaultCustom(existing: string | null, ours: string): MergeResult {
  const patches = ourListPatches(ours);
  if (existing === null || existing.trim() === '') {
    const added = patches.flatMap((p) => p.items.map((item) => `${p.path}: ${p.identity(item)}`));
    return { content: ours, changed: true, added };
  }

  const doc = parseStrict(existing, 'your default.custom.yaml');
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  if (!isMap(doc.contents)) {
    throw new RimeUserConfigError('Your default.custom.yaml is not a YAML map.');
  }

  let patch = doc.get('patch', true);
  if (patch === undefined || (isScalar(patch) && patch.value === null)) {
    patch = doc.createNode({}) as YAMLMap;
    doc.set('patch', patch);
  }
  if (!isMap(patch)) {
    throw new RimeUserConfigError('patch: in your default.custom.yaml is not a map.');
  }

  const added: string[] = [];
  for (const { path, items, identity } of patches) {
    const list = findUserList(patch, path);
    const present = new Set(list?.items.map(identity) ?? []);
    const missing = items.filter((item) => !present.has(identity(item)));
    if (missing.length === 0) continue;

    if (list) {
      for (const item of missing) list.add(doc.createNode(item));
    } else {
      patch.set(`${path}/+`, doc.createNode(missing));
    }
    added.push(...missing.map((item) => `${path}: ${identity(item)}`));
  }

  if (added.length === 0) return { content: existing, changed: false, added };
  return { content: doc.toString(), changed: true, added };
}
