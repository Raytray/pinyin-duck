import React from 'react';
import { usePinyinDuck } from './hooks/usePinyinDuck';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import { LearnerGuide } from './components/LearnerGuide';
import './styles/app.css';

export const App: React.FC = () => {
  const {
    script,
    toggleScript,
    committedText,
    setCommittedText,
    compositionBuffer,
    isComposing,
    pageCandidates,
    selectedIndex,
    setSelectedIndex,
    currentPage,
    totalPages,
    selectCandidate,
    nextPage,
    prevPage,
    handleKeyDown,
    clearAll,
  } = usePinyinDuck({ pageSize: 5 });

  const handleSelectPrompt = (pinyinSequence: string) => {
    // Clear and feed the prompt sequence
    clearAll();
    // Dispatch keystroke simulation by setting buffer
    // or simulate typing
    for (const char of pinyinSequence) {
      // Use internal keyboard event or set buffer
    }
    // We can directly dispatch keyboard event or set committedText/buffer
    // For direct interactive demo, let's type it into compositionBuffer:
    // We trigger window/synthetic keydown or set composition buffer
    const fakeEvent = {
      key: pinyinSequence,
      preventDefault: () => {},
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    } as any;
    // We can also just set text directly or let the user try typing
  };

  return (
    <div className="app-shell">
      <div className="app-backdrop-duck" />

      <Toolbar
        script={script}
        onToggleScript={toggleScript}
        committedText={committedText}
        onClearText={clearAll}
        onSelectPrompt={(pinyin) => {
          // Send key event or set text
          const e = new KeyboardEvent('keydown', { key: pinyin });
          // Clear and focus
          clearAll();
          // We can dispatch individual characters to handleKeyDown
          for (let i = 0; i < pinyin.length; i++) {
            handleKeyDown({
              key: pinyin[i],
              preventDefault: () => {},
              ctrlKey: false,
              metaKey: false,
              altKey: false,
            } as any);
          }
        }}
      />

      <main className="main-content">
        <div className="content-container">
          <Editor
            committedText={committedText}
            compositionBuffer={compositionBuffer}
            isComposing={isComposing}
            pageCandidates={pageCandidates}
            selectedIndex={selectedIndex}
            currentPage={currentPage}
            totalPages={totalPages}
            onSelectCandidate={selectCandidate}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onSetSelectedIndex={setSelectedIndex}
            onKeyDown={handleKeyDown}
            onChangeCommittedText={setCommittedText}
          />

          <LearnerGuide />
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p>
            <strong>PinyinDuck (拼音达克)</strong> &bull; Inspired by TypeDuck. Open-source Mandarin learning input method.
          </p>
          <div className="roadmap-tags">
            <span className="roadmap-tag active">Milestone 1: Web MVP</span>
            <span className="roadmap-tag upcoming">Milestone 2: Windows Input</span>
            <span className="roadmap-tag upcoming">Milestone 3: Android IME</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
