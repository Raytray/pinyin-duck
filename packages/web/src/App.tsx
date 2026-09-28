import React from 'react';
import { usePinyinDuck } from './hooks/usePinyinDuck';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import './styles/app.css';

export const App: React.FC = () => {
  const {
    script,
    toggleScript,
    committedText,
    setCommittedText,
    insertPos,
    setInsertPos,
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
    handleTextareaChange,
    cursorToRestore,
    clearAll,
  } = usePinyinDuck({ pageSize: 5 });

  return (
    <div className="app-shell">
      <div className="app-backdrop-duck" />

      <Toolbar
        script={script}
        onToggleScript={toggleScript}
        committedText={committedText}
        onClearText={clearAll}
      />

      <main className="main-content">
        <div className="content-container">
          <Editor
            committedText={committedText}
            compositionBuffer={compositionBuffer}
            insertPos={insertPos}
            isComposing={isComposing}
            pageCandidates={pageCandidates}
            selectedIndex={selectedIndex}
            currentPage={currentPage}
            totalPages={totalPages}
            cursorToRestore={cursorToRestore}
            onSelectCandidate={selectCandidate}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onSetSelectedIndex={setSelectedIndex}
            onSetInsertPos={setInsertPos}
            onKeyDown={handleKeyDown}
            onChangeTextarea={handleTextareaChange}
          />
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
