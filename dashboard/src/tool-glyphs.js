import kimiMono from '@lobehub/icons-static-svg/icons/kimi.svg?raw';
import claudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import copilotIcon from '@lobehub/icons-static-svg/icons/copilot-color.svg';
import openCodeMono from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import cursorMono from '@lobehub/icons-static-svg/icons/cursor.svg?raw';
import qoderIcon from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import traeIcon from '@lobehub/icons-static-svg/icons/trae-color.svg';
import windsurfMono from '@lobehub/icons-static-svg/icons/windsurf.svg?raw';
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
  windsurf: { svg: windsurfMono, tone: 'windsurf', label: 'Windsurf' },
  'roo-code': { svg: rooCodeMono, tone: 'roo', label: 'Roo Code' },
  'pi-coding-agent': { svg: piMono, tone: 'pi', label: 'Pi' },
  zcode: { svg: zaiMono, tone: 'zcode', label: 'ZCode' },
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
  const { svg, src, tone, label } = item;
  return createElement('span', {
    className: `tool-glyph tool-glyph--${tone} ${className}`,
    style: { width: frame, height: frame, fontSize: size },
    title: label,
    'aria-hidden': true,
  }, svg
    ? createElement('span', {
      className: 'tool-glyph__svg',
      style: { display: 'contents' },
      dangerouslySetInnerHTML: { __html: svg },
    })
    : createElement('img', { src, width: size, height: size, alt: '' }));
}
