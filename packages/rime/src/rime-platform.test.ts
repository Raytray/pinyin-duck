/**
 * Tests for the per-platform template rendering.
 *
 * The point of rendering is that Windows and macOS can only differ where the platform
 * table says so. These pin that: every template renders for every platform with nothing
 * left unfilled, and the rendered pair differs only on lines that name a platform.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  PLATFORM_INFO,
  RIME_PLATFORMS,
  TEMPLATE_FILES,
  isRimePlatform,
  renderTemplate,
  templateValues,
} from './rime-platform.js';

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const read = (name: string) => fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');

describe('isRimePlatform', () => {
  it('accepts the two platforms and nothing else', () => {
    expect(isRimePlatform('windows')).toBe(true);
    expect(isRimePlatform('macos')).toBe(true);
    expect(isRimePlatform('linux')).toBe(false);
    expect(isRimePlatform('')).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('fills every placeholder', () => {
    const out = renderTemplate('x.yaml', '{{HOST}} on {{OS}}: {{INSTALL_COMMAND}} ({{PLATFORM}})\n', 'macos');
    expect(out).toContain('Squirrel on macOS: bash scripts/install.sh (macos)');
  });

  it('refuses a placeholder the platform table does not define', () => {
    expect(() => renderTemplate('x.yaml', '{{NOPE}}', 'windows')).toThrow(
      /Unknown placeholder \{\{NOPE\}\} in templates\/x\.yaml/
    );
  });

  it('marks the output as generated, in the comment syntax of the file', () => {
    expect(renderTemplate('a.yaml', 'k: v\n', 'windows')).toMatch(/^# Generated for Windows/);
    expect(renderTemplate('lua/a.lua', 'return 1\n', 'macos')).toMatch(/^-- Generated for macOS/);
    expect(renderTemplate('a.yaml', 'k: v\n', 'windows')).toContain('packages/rime/templates/a.yaml');
  });
});

describe('the committed templates', () => {
  for (const name of TEMPLATE_FILES) {
    for (const platform of RIME_PLATFORMS) {
      it(`${name} renders for ${platform} with nothing left unfilled`, () => {
        const out = renderTemplate(name, read(name), platform);
        expect(out).not.toMatch(/\{\{|\}\}/);
      });
    }

    it(`${name} differs between platforms only where a platform is named`, () => {
      const [a, b] = RIME_PLATFORMS.map((p) => renderTemplate(name, read(name), p).split('\n'));
      expect(a.length).toBe(b.length);
      const names = RIME_PLATFORMS.flatMap((p) => Object.values(templateValues(p)));
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        // Any line that differs has to mention one of the values the table supplies.
        expect(names.some((value) => a[i].includes(value))).toBe(true);
      }
    });
  }

  it('the schemas are valid YAML once rendered', async () => {
    const { parse } = await import('yaml');
    for (const platform of RIME_PLATFORMS) {
      for (const name of TEMPLATE_FILES.filter((n) => n.endsWith('.yaml'))) {
        expect(() => parse(renderTemplate(name, read(name), platform))).not.toThrow();
      }
    }
  });
});

describe('PLATFORM_INFO', () => {
  it('names an installer that exists in each platform package', () => {
    for (const platform of RIME_PLATFORMS) {
      const script = PLATFORM_INFO[platform].installCommand.split(' ').pop()!;
      const installer = path.resolve(__dirname, '../..', platform, script);
      expect(fs.existsSync(installer), installer).toBe(true);
    }
  });
});
