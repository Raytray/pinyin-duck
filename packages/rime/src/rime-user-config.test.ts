import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { mergeDefaultCustom, RimeUserConfigError } from './rime-user-config';

import { RIME_PLATFORMS, renderTemplate } from './rime-platform';

/** The template the installers' file is rendered from, so the tests follow it if it changes. */
const TEMPLATE = fs.readFileSync(path.resolve(__dirname, '../templates/default.custom.yaml'), 'utf8');

const PINYINDUCK_SCHEMAS = [{ schema: 'pinyinduck' }, { schema: 'pinyinduck_trad' }];
const SAVE_OPTIONS = ['ascii_mode', 'ascii_punct', 'full_shape'];

/** A typical customized file: a replaced scheme list, a hotkey and a comment. */
const CUSTOMIZED = `# my Rime setup
patch:
  schema_list:
    - schema: luna_pinyin   # the one I use most
    - schema: cangjie5
  "switcher/hotkeys":
    - Control+grave
  menu/page_size: 9
`;

// Run against each platform's rendered file, banner and all: that, not the raw template, is
// what install.ps1 and install.sh hand to the merge.
describe.each(RIME_PLATFORMS)('mergeDefaultCustom (%s)', (platform) => {
  const OURS = renderTemplate('default.custom.yaml', TEMPLATE, platform);

  it('uses our file as it is when there is none yet', () => {
    expect(mergeDefaultCustom(null, OURS)).toEqual({
      content: OURS,
      changed: true,
      added: [
        'schema_list: schema:pinyinduck',
        'schema_list: schema:pinyinduck_trad',
        'switcher/save_options: ascii_mode',
        'switcher/save_options: ascii_punct',
        'switcher/save_options: full_shape',
      ],
    });
  });

  it('treats an empty file as no file', () => {
    expect(mergeDefaultCustom('\n', OURS).content).toBe(OURS);
  });

  it('appends to a replaced scheme list and keeps every user entry and comment', () => {
    const { content, changed } = mergeDefaultCustom(CUSTOMIZED, OURS);
    expect(changed).toBe(true);
    expect(parse(content)).toEqual({
      patch: {
        schema_list: [{ schema: 'luna_pinyin' }, { schema: 'cangjie5' }, ...PINYINDUCK_SCHEMAS],
        'switcher/hotkeys': ['Control+grave'],
        'menu/page_size': 9,
        'switcher/save_options/+': SAVE_OPTIONS,
      },
    });
    expect(content).toContain('# my Rime setup');
    expect(content).toContain('# the one I use most');
  });

  it('changes nothing the second time', () => {
    const once = mergeDefaultCustom(CUSTOMIZED, OURS).content;
    expect(mergeDefaultCustom(once, OURS)).toEqual({ content: once, changed: false, added: [] });
    expect(mergeDefaultCustom(OURS, OURS)).toEqual({ content: OURS, changed: false, added: [] });
  });

  it('appends to an existing append list without duplicating entries', () => {
    const existing = 'patch:\n  schema_list/+:\n    - schema: pinyinduck\n    - schema: terra_pinyin\n';
    const { content, added } = mergeDefaultCustom(existing, OURS);
    expect(parse(content).patch['schema_list/+']).toEqual([
      { schema: 'pinyinduck' },
      { schema: 'terra_pinyin' },
      { schema: 'pinyinduck_trad' },
    ]);
    expect(added).not.toContain('schema_list: schema:pinyinduck');
  });

  it('adds to save_options inside a replaced switcher map rather than beside it', () => {
    const existing = 'patch:\n  switcher:\n    caption: 〔方案〕\n    save_options:\n      - ascii_mode\n      - simplification\n';
    const merged = parse(mergeDefaultCustom(existing, OURS).content);
    expect(merged.patch.switcher).toEqual({
      caption: '〔方案〕',
      save_options: ['ascii_mode', 'simplification', 'ascii_punct', 'full_shape'],
    });
    expect(merged.patch).not.toHaveProperty('switcher/save_options/+');
  });

  it('adds a patch map to a file that has none, keeping its other keys', () => {
    const merged = parse(mergeDefaultCustom('customization:\n  distribution_code_name: Weasel\n', OURS).content);
    expect(merged.customization).toEqual({ distribution_code_name: 'Weasel' });
    expect(merged.patch['schema_list/+']).toEqual(PINYINDUCK_SCHEMAS);
  });

  it('fills in an empty patch: key and a comment-only file', () => {
    expect(parse(mergeDefaultCustom('patch:\n', OURS).content).patch['schema_list/+']).toEqual(PINYINDUCK_SCHEMAS);
    expect(parse(mergeDefaultCustom('# nothing yet\n', OURS).content).patch['schema_list/+']).toEqual(
      PINYINDUCK_SCHEMAS
    );
  });

  it.each([
    ['invalid YAML', 'patch: [unclosed\n', /Could not parse your default.custom.yaml/],
    ['a top-level list', '- one\n', /not a YAML map/],
    ['a scalar patch', 'patch: 3\n', /patch: in your default.custom.yaml is not a map/],
    ['a scalar scheme list', 'patch:\n  schema_list: luna\n', /patch\/schema_list .* not a list/],
    ['a scalar nested list', 'patch:\n  switcher:\n    save_options: x\n', /patch\/switcher\/save_options .* not a list/],
  ])('refuses %s rather than guessing', (_name, existing, message) => {
    expect(() => mergeDefaultCustom(existing, OURS)).toThrow(RimeUserConfigError);
    expect(() => mergeDefaultCustom(existing, OURS)).toThrow(message);
  });

  it('rejects a shipped file that is not all appends', () => {
    expect(() => mergeDefaultCustom(null, 'patch:\n  schema_list: []\n')).toThrow(/cannot be merged/);
    expect(() => mergeDefaultCustom(null, 'schema_list: []\n')).toThrow(/has no patch: map/);
    expect(() => mergeDefaultCustom(null, 'patch: [\n')).toThrow(/the PinyinDuck default.custom.yaml/);
  });

  it('identifies scheme entries by name whatever their other keys', () => {
    const existing = 'patch:\n  schema_list:\n    - {schema: pinyinduck, extra: 1}\n    - schema: pinyinduck_trad\n    - 42\n';
    const { added } = mergeDefaultCustom(existing, OURS);
    expect(added.filter((a) => a.startsWith('schema_list'))).toEqual([]);
  });
});
