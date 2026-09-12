// Public, non-secret source-location contract. Keep credentials out of this list:
// native daemon descriptors persist these values on disk.
export const SOURCE_PATH_ENVIRONMENT = Object.freeze(Object.fromEntries(Object.entries({
  shared: ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'APPDATA', 'LOCALAPPDATA'],
  antigravity: ['KBU_USAGE_ANTIGRAVITY_DIR'],
  'claude-code': ['CLAUDE_CONFIG_DIR', 'KBU_USAGE_CLAUDE_DIRS', 'KBU_USAGE_CLAUDE_DESKTOP_DIRS'],
  codex: ['CODEX_HOME', 'KBU_USAGE_CODEX_HOME'],
  copilot: ['KBU_USAGE_COPILOT_DIR'],
  cursor: ['KBU_USAGE_CURSOR_CSV'],
  dsh: ['DSH_HOME', 'KBU_USAGE_DSH_SESSIONS'],
  'gemini-cli': ['KBU_USAGE_GEMINI_DIR'],
  grok: ['GROK_HOME', 'KBU_USAGE_GROK_SESSIONS'],
  'kimi-code': ['KIMI_CODE_HOME', 'KBU_USAGE_KIMI_CODE_DIR', 'KBU_USAGE_KIMI_DIR'],
  mcode: ['MCODE_HOME', 'KBU_USAGE_MCODE_DB'],
  opencode: ['KBU_USAGE_OPENCODE_DIR'],
  'pi-coding-agent': ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'KBU_USAGE_PI_SESSION_DIRS'],
  qoder: ['QODER_CONFIG_DIR', 'QODER_HOME', 'KBU_USAGE_QODER_PROJECTS', 'KBU_USAGE_QODER_DB'],
  'qoder-cn': ['QODERCN_CONFIG_DIR', 'QODER_CN_HOME', 'KBU_USAGE_QODER_CN_PROJECTS', 'KBU_USAGE_QODER_CN_DB'],
  'roo-code': ['KBU_USAGE_ROO_DIRS'],
  'trae-cli': ['KBU_USAGE_TRAE_CLI_SESSIONS'],
  workbuddy: ['KBU_USAGE_WORKBUDDY_DIRS'],
  zcode: ['KBU_USAGE_ZCODE_DB'],
}).map(([source, keys]) => [source, Object.freeze(keys)])));

export const SOURCE_PATH_ENVIRONMENT_VARIABLES = Object.freeze([...new Set(Object.values(SOURCE_PATH_ENVIRONMENT).flat())]);
