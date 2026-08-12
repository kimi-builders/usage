import kimiIcon from '@lobehub/icons-static-svg/icons/kimi-color.svg';
import claudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import copilotIcon from '@lobehub/icons-static-svg/icons/copilot-color.svg';
import openCodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg';
import qoderIcon from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import traeIcon from '@lobehub/icons-static-svg/icons/trae-color.svg';
import windsurfIcon from '@lobehub/icons-static-svg/icons/windsurf.svg';
import rooCodeIcon from '@lobehub/icons-static-svg/icons/roocode.svg';
import { createElement } from 'react';

const TOOL_ICONS = {
  'kimi-code': { src: kimiIcon, tone: 'kimi', label: 'Kimi Code' },
  'claude-code': { src: claudeCodeIcon, tone: 'claude', label: 'Claude Code' },
  codex: { src: codexIcon, tone: 'codex', label: 'Codex' },
  'gemini-cli': { src: geminiCliIcon, tone: 'gemini', label: 'Gemini CLI' },
  antigravity: { src: antigravityIcon, tone: 'antigravity', label: 'Antigravity' },
  'copilot-cli': { src: copilotIcon, tone: 'copilot', label: 'Copilot CLI' },
  copilot: { src: copilotIcon, tone: 'copilot', label: 'GitHub Copilot' },
  opencode: { src: openCodeIcon, tone: 'opencode', label: 'OpenCode', mono: true },
  cursor: { src: cursorIcon, tone: 'cursor', label: 'Cursor', mono: true },
  qoder: { src: qoderIcon, tone: 'qoder', label: 'Qoder' },
  trae: { src: traeIcon, tone: 'trae', label: 'Trae' },
  windsurf: { src: windsurfIcon, tone: 'windsurf', label: 'Windsurf', mono: true },
  'roo-code': { src: rooCodeIcon, tone: 'roo', label: 'Roo Code', mono: true },
};

export function ToolGlyph({ id, size = 16, className = '' }) {
  const item = TOOL_ICONS[id];
  const frame = Math.max(18, Math.round(size + 7));
  if (!item) {
    return createElement('span', {
      className: `tool-glyph tool-glyph--fallback ${className}`,
      style: { width: frame, height: frame, fontSize: Math.max(8, size * 0.55) },
      'aria-hidden': true,
    }, String(id || '?').slice(0, 1).toUpperCase());
  }
  const { src, tone, label, mono } = item;
  return createElement('span', {
    className: `tool-glyph tool-glyph--${tone}${mono ? ' tool-glyph--mono' : ''} ${className}`,
    style: { width: frame, height: frame },
    title: label,
    'aria-hidden': true,
  }, createElement('img', { src, width: size, height: size, alt: '' }));
}
