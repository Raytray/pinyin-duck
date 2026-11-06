/**
 * The Rime hosts PinyinDuck installs into, and the templates their files are rendered from.
 *
 * Weasel (Windows) and Squirrel (macOS) are both frontends for the same librime, so they read
 * the same schema, dictionary and Lua filter formats. What differs is a handful of words in
 * the comments — the frontend's name, the OS, the install command — and where the files land.
 * Keeping one template per file and rendering it per platform is what stops the two copies
 * drifting, which they did while they were maintained by hand.
 */

export const RIME_PLATFORMS = ['windows', 'macos'] as const;

export type RimePlatform = (typeof RIME_PLATFORMS)[number];

export interface RimePlatformInfo {
  /** The librime frontend that loads the files. */
  host: string;
  /** The operating system, as a user would name it. */
  os: string;
  /** How to run the installer from the platform package directory. */
  installCommand: string;
  /** Where the installer copies the files, as the user would type it. */
  userDir: string;
}

export const PLATFORM_INFO: Record<RimePlatform, RimePlatformInfo> = {
  windows: {
    host: 'Weasel',
    os: 'Windows',
    installCommand: 'powershell -File scripts/install.ps1',
    userDir: '%APPDATA%\\Rime',
  },
  macos: {
    host: 'Squirrel',
    os: 'macOS',
    installCommand: 'bash scripts/install.sh',
    userDir: '~/Library/Rime',
  },
};

/**
 * The hand-written files rendered into every platform's `rime/` folder, as paths relative
 * to `templates/`. The dictionaries and the gloss sidecar are generated separately.
 */
export const TEMPLATE_FILES = [
  'pinyinduck.schema.yaml',
  'pinyinduck_trad.schema.yaml',
  'default.custom.yaml',
  'lua/pinyinduck_gloss_filter.lua',
] as const;

export function isRimePlatform(value: string): value is RimePlatform {
  return (RIME_PLATFORMS as readonly string[]).includes(value);
}

/** The placeholder values a template may use. */
export function templateValues(platform: RimePlatform): Record<string, string> {
  const info = PLATFORM_INFO[platform];
  return {
    PLATFORM: platform,
    HOST: info.host,
    OS: info.os,
    INSTALL_COMMAND: info.installCommand,
  };
}

/**
 * Fills `{{NAME}}` placeholders and prepends a do-not-edit banner.
 *
 * An unknown placeholder is an error rather than left in place: a schema that ships the
 * literal text `{{HOST}}` in a comment is harmless, but one in a value would break a deploy,
 * and either way it means the template and this table have drifted.
 */
export function renderTemplate(
  name: string,
  template: string,
  platform: RimePlatform
): string {
  const values = templateValues(platform);
  const body = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unknown placeholder ${match} in templates/${name}`);
    }
    return value;
  });
  const comment = name.endsWith('.lua') ? '--' : '#';
  const banner =
    `${comment} Generated for ${PLATFORM_INFO[platform].os} by \`npm run build:rime\` from ` +
    `packages/rime/templates/${name}.\n` +
    `${comment} Edit the template, not this file.\n`;
  return banner + body;
}
