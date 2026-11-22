import React from 'react';
import { usePinyinDuck } from './hooks/usePinyinDuck';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import './styles/app.css';

export const App: React.FC = () => {
  const {
    script,
    toggleScript,
    dictionaryStatus,
    dictionaryError,
    downloadProgress,
    entryCount,
    committedText,
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
    detail,
    toggleDetail,
    nextPage,
    prevPage,
    handleKeyDown,
    handleTextareaChange,
    cursorToRestoreRef,
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
          {dictionaryStatus === 'error' && (
            <div className="dictionary-error" role="alert">
              <strong>Could not load the dictionary.</strong>
              <span>{dictionaryError}</span>
            </div>
          )}
          <Editor
            committedText={committedText}
            compositionBuffer={compositionBuffer}
            insertPos={insertPos}
            isComposing={isComposing}
            pageCandidates={pageCandidates}
            selectedIndex={selectedIndex}
            currentPage={currentPage}
            totalPages={totalPages}
            cursorToRestoreRef={cursorToRestoreRef}
            dictionaryStatus={dictionaryStatus}
            downloadProgress={downloadProgress}
            entryCount={entryCount}
            onSelectCandidate={selectCandidate}
            detail={detail}
            onToggleDetail={toggleDetail}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onSetSelectedIndex={setSelectedIndex}
            onSetInsertPos={setInsertPos}
            onKeyDown={handleKeyDown}
            onChangeTextarea={handleTextareaChange}
          />
        </div>
      </main>

    </div>
  );
};

export default App;
