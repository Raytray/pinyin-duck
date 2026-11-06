import React, { useRef } from 'react';
import { Info, X } from 'lucide-react';

const CC_BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/';

/** A dictionary source and the credit its license asks for. */
interface Source {
  name: string;
  author: string;
  license: string;
  licenseUrl: string;
  url: string;
}

/** Keep in step with DATA_LICENSES.md, which has the full notices. */
const SOURCES: Source[] = [
  {
    name: 'CC-CEDICT',
    author: 'MDBG and the CC-CEDICT contributors',
    license: 'CC BY-SA 4.0',
    licenseUrl: CC_BY_SA,
    url: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
  },
  {
    name: 'FrequencyWords (OpenSubtitles 2018)',
    author: 'Hermit Dave',
    license: 'CC BY-SA 4.0',
    licenseUrl: CC_BY_SA,
    url: 'https://github.com/hermitdave/FrequencyWords',
  },
  {
    name: 'HSK 2012 word list',
    author: '© 2018 gigacool',
    license: 'MIT',
    licenseUrl: 'https://github.com/gigacool/hanyu-shuiping-kaoshi/blob/master/LICENSE',
    url: 'https://github.com/gigacool/hanyu-shuiping-kaoshi',
  },
];

/**
 * The toolbar's Credits button and the dialog it opens.
 *
 * The page downloads a dictionary built from CC BY-SA sources, and CC BY-SA requires them
 * to be credited wherever it is distributed. This is that credit for the web app.
 */
export const Credits: React.FC = () => {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="action-btn"
        onClick={() => dialog.current?.showModal()}
        title="Dictionary sources and licenses"
      >
        <Info size={16} />
        <span>Credits</span>
      </button>

      <dialog
        ref={dialog}
        className="credits-dialog"
        aria-labelledby="credits-title"
        // A click on the backdrop lands on the dialog element itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="credits-header">
          <h2 id="credits-title">Credits</h2>
          <button
            type="button"
            className="credits-close"
            onClick={() => dialog.current?.close()}
            aria-label="Close credits"
          >
            <X size={18} />
          </button>
        </div>
        <p>
          The dictionary is built from the sources below and is licensed under{' '}
          <a href={CC_BY_SA} target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
          . PinyinDuck&apos;s code is under the MIT License.
        </p>
        <ul className="credits-list">
          {SOURCES.map((source) => (
            <li key={source.name}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name}
              </a>
              <span>
                {source.author} ·{' '}
                <a href={source.licenseUrl} target="_blank" rel="noreferrer">
                  {source.license}
                </a>
              </span>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
};
