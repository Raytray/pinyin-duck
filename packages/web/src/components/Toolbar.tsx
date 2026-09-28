import React, { useState } from 'react';
import { ScriptType } from '@pinyinduck/core';
import { Copy, Check, Trash2, Globe2, BookOpen, Sparkles } from 'lucide-react';

interface ToolbarProps {
  script: ScriptType;
  onToggleScript: () => void;
  committedText: string;
  onClearText: () => void;
  onSelectPrompt: (pinyinSequence: string) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  script,
  onToggleScript,
  committedText,
  onClearText,
  onSelectPrompt,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!committedText) return;
    try {
      await navigator.clipboard.writeText(committedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const samplePrompts = [
    { label: '👋 Hello', pinyin: 'nihao' },
    { label: '🙏 Thank you', pinyin: 'xiexie' },
    { label: '🇨🇳 China', pinyin: 'zhongguo' },
    { label: '🙋 He vs She', pinyin: 'ta' },
    { label: '🎯 Tone 4: shì (是)', pinyin: 'shi4' },
    { label: '🔟 Tone 2: shí (十)', pinyin: 'shi2' },
    { label: '🏯 Tiananmen', pinyin: "tian'an'men" },
  ];

  return (
    <header className="duck-toolbar">
      <div className="toolbar-brand">
        <div className="duck-logo">🦆</div>
        <div className="brand-text">
          <h1>PinyinDuck</h1>
          <span className="brand-sub">TypeDuck for Mandarin Learners</span>
        </div>
      </div>

      {/* Quick learner prompts */}
      <div className="toolbar-prompts">
        <span className="prompts-label">Try typing:</span>
        <div className="prompt-badges">
          {samplePrompts.map((p) => (
            <button
              key={p.pinyin}
              type="button"
              className="prompt-badge"
              onClick={() => onSelectPrompt(p.pinyin)}
              title={`Click to test typing "${p.pinyin}"`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="toolbar-actions">
        <button
          type="button"
          className="action-btn script-toggle"
          onClick={onToggleScript}
          title="Toggle between Simplified and Traditional Chinese"
        >
          <Globe2 size={16} />
          <span>{script === 'simplified' ? '简体 (Simplified)' : '繁體 (Traditional)'}</span>
        </button>

        <button
          type="button"
          className="action-btn"
          onClick={handleCopy}
          disabled={!committedText}
          title="Copy text to clipboard"
        >
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>

        <button
          type="button"
          className="action-btn text-danger"
          onClick={onClearText}
          disabled={!committedText}
          title="Clear editor"
        >
          <Trash2 size={16} />
          <span>Clear</span>
        </button>
      </div>
    </header>
  );
};
