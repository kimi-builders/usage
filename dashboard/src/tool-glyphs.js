import kimiMono from '@lobehub/icons-static-svg/icons/kimi.svg?raw';
import claudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import codeBuddyIcon from '@lobehub/icons-static-svg/icons/codebuddy-color.svg';
import copilotIcon from '@lobehub/icons-static-svg/icons/copilot-color.svg';
import openCodeMono from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import cursorMono from '@lobehub/icons-static-svg/icons/cursor.svg?raw';
import qoderIcon from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import traeIcon from '@lobehub/icons-static-svg/icons/trae-color.svg';
import rooCodeMono from '@lobehub/icons-static-svg/icons/roocode.svg?raw';
import piMono from '@lobehub/icons-static-svg/icons/pi.svg?raw';
import zaiMono from '@lobehub/icons-static-svg/icons/zai.svg?raw';
import { createElement } from 'react';

/* Agent glyph registry — mirrors the site's components/AgentIcon.tsx split:
   Color brand marks render as <img>; Mono marks are inlined raw SVG so
   currentColor follows the tone ink (and the theme) like the site's Mono icons. */
const TOOL_ICONS = {
  'kimi-code': { svg: kimiMono, tone: 'kimi', label: 'Kimi Code' },
  'claude-code': { src: claudeCodeIcon, tone: 'claude', label: 'Claude Code' },
  codex: { src: codexIcon, tone: 'codex', label: 'Codex' },
  'gemini-cli': { src: geminiCliIcon, tone: 'gemini', label: 'Gemini CLI' },
  antigravity: { src: antigravityIcon, tone: 'antigravity', label: 'Antigravity' },
  'copilot-cli': { src: copilotIcon, tone: 'copilot', label: 'Copilot CLI' },
  copilot: { src: copilotIcon, tone: 'copilot', label: 'GitHub Copilot' },
  opencode: { svg: openCodeMono, tone: 'opencode', label: 'OpenCode' },
  cursor: { svg: cursorMono, tone: 'cursor', label: 'Cursor' },
  qoder: { src: qoderIcon, tone: 'qoder', label: 'Qoder' },
  trae: { src: traeIcon, tone: 'trae', label: 'Trae' },
  'roo-code': { svg: rooCodeMono, tone: 'roo', label: 'Roo Code' },
  'pi-coding-agent': { svg: piMono, tone: 'pi', label: 'Pi' },
  zcode: { svg: zaiMono, tone: 'zcode', label: 'ZCode' },
  workbuddy: { src: codeBuddyIcon, tone: 'workbuddy', label: 'WorkBuddy' },
};

export function ToolGlyph({ id, size, context = 'inline', className = '' }) {
  const item = TOOL_ICONS[id];
  const glyphSize = size ?? (context === 'inline' ? 14 : 12);
  const frame = context === 'chart' ? 16 : context === 'badge' ? 20 : Math.max(18, Math.round(glyphSize + 7));
  if (!item) {
    return createElement('span', {
      className: `tool-glyph tool-glyph--${context} tool-glyph--fallback ${className}`,
      style: { width: frame, height: frame, fontSize: Math.max(8, glyphSize * 0.55) },
      'aria-hidden': true,
    }, String(id || '?').slice(0, 1).toUpperCase());
  }
  const { svg, src, tone, label } = item;
  return createElement('span', {
    className: `tool-glyph tool-glyph--${context} tool-glyph--${tone} ${className}`,
    style: { width: frame, height: frame, fontSize: glyphSize },
    title: label,
    'aria-hidden': true,
  }, svg
    ? createElement('span', {
      className: 'tool-glyph__svg',
      style: { display: 'contents' },
      dangerouslySetInnerHTML: { __html: svg },
    })
    : createElement('img', { src, width: glyphSize, height: glyphSize, alt: '' }));
}
