const DICTIONARY = {
  zh: {
    'cli.description': '本地优先的 AI Coding Agent 用量分析与额度监控工具',
    'cli.category.analytics': '▸ 用量分析与看板',
    'cli.category.sync': '▸ 社区同步与后台服务',
    'cli.category.diagnostics': '▸ 来源检测与诊断',
    'cli.category.options': '▸ 通用选项',

    'status.ok': '正常',
    'status.skipped': '跳过',
    'status.partial': '部分',
    'status.failed': '失败',
    'status.running': '运行中',
    'status.error': '异常',

    'unit.seconds': '秒',
    'unit.minutes': '分钟',
    'unit.hours': '小时',
    'unit.days': '天',

    'sync.scanning': '来源扫描：',
    'sync.header': '来源扫描与本地解析',
    'sync.source': '来源',
    'sync.status': '状态',
    'sync.tokens': 'Token 总量',
    'sync.cost': '费用估算',
    'sync.duration': '活跃时长',
    'sync.sessions': '会话 / 批次',
    'sync.total': '合计',
    'sync.completed_title': '增量同步完成',
    'sync.synced': '已同步 {buckets} buckets · {sessions} sessions',
    'sync.no_changes': '暂无新增或变化的用量。',
    'sync.partial_warning': '⚠ 部分来源解析失败，其余来源不受影响；失败来源的旧数据已保留。',
    'sync.protected': '服务端保留了 {count} 个更大的已有 bucket（本次较小快照未覆盖）',
    'sync.rejected_warning': '⚠ 本地校验隔离了 {count} 条异常记录，其余数据已继续同步：',
    'sync.skipped_hint': '未检测到本地数据，已跳过',
    'sync.partial_hint': '（部分读取，本来源旧数据已保留）',
    'sync.failed_hint': '解析失败：{error}（已保留该来源的旧数据）',
    'sync.reconciliation_required': '当前 checkpoint 无法证明属于这个社区设备。为避免意外全量上传，本次已取消；确认同步范围后运行 `npx @kimi.builders/usage sync --full`，或在本地看板中确认“完整重建社区数据”。',

    'sources.title': '数据源：',
    'sources.mode_off': '关闭',
    'sources.mode_local': '仅本机',
    'sources.mode_private': '本机并同步',
    'sources.tier_beta': '（Beta）',
    'sources.tier_explicit': '（显式数据源）',
    'sources.set_success': '{sourceId} 已设为 {mode}；远端历史数据未删除。',
    'sources.enabled_success': '已启用 {sourceId}。',
    'sources.disabled_success': '已停用 {sourceId}；远端历史数据未删除。',

    'inspect.dry_run': 'Kimi Builders Usage · dry run（未联网）',
    'inspect.roots_title': '来源与读取目录:',
    'inspect.not_detected': '未检测到',
    'inspect.parsing_failed': '解析失败',
    'inspect.default_upload_fields': '默认上传字段:',
    'inspect.detected_result': '检测结果:',
    'inspect.protocol_validation': '协议校验:',

    'status.title': '◆ Kimi Builders Usage 运行状态',
    'status.local_engine': '【本地数据引擎】',
    'status.community_sync': '【社区同步服务】',
    'status.quick_tips': '【快捷命令】',
    'status.connected': '已连接',
    'status.not_connected': '未连接',
    'status.sources_summary': '• 来源状态: {available} 个可用 · {skipped} 个跳过 (共解析 {tokens} Tokens, {sessions} 会话)',
    'status.storage_summary': '• 存储占用: 本地快照 {size} · Checkpoint 正常',
    'status.daemon_summary': '• 后台服务: {status}',
  },
  en: {
    'cli.description': 'Local-first usage analytics & quota monitor for AI coding agents',
    'cli.category.analytics': '▸ Analytics & Dashboard',
    'cli.category.sync': '▸ Sync & Background Service',
    'cli.category.diagnostics': '▸ Sources & Diagnostics',
    'cli.category.options': '▸ General Options',

    'status.ok': 'OK',
    'status.skipped': 'Skipped',
    'status.partial': 'Partial',
    'status.failed': 'Failed',
    'status.running': 'Running',
    'status.error': 'Error',

    'unit.seconds': 's',
    'unit.minutes': 'm',
    'unit.hours': 'h',
    'unit.days': 'd',

    'sync.scanning': 'Source scan:',
    'sync.header': 'Source Scan & Local Parsing',
    'sync.source': 'Source',
    'sync.status': 'Status',
    'sync.tokens': 'Tokens',
    'sync.cost': 'Est. Cost',
    'sync.duration': 'Active Time',
    'sync.sessions': 'Sessions / Buckets',
    'sync.total': 'Total',
    'sync.completed_title': 'Incremental Sync Completed',
    'sync.synced': 'Synced {buckets} buckets · {sessions} sessions',
    'sync.no_changes': 'No new or modified usage.',
    'sync.partial_warning': '⚠ Some sources failed to parse; remaining sources are unaffected and previous data is preserved.',
    'sync.protected': 'Server preserved {count} larger existing buckets (not overwritten by this smaller snapshot)',
    'sync.rejected_warning': '⚠ Local validation quarantined {count} abnormal records; remaining data synced successfully:',
    'sync.skipped_hint': 'no local data found, skipped',
    'sync.partial_hint': '(partially read, previous data retained)',
    'sync.failed_hint': 'parsing failed: {error} (previous data retained)',
    'sync.reconciliation_required': 'Current checkpoint cannot be verified for this community device. To prevent accidental full upload, this sync was cancelled. Verify sync scope and run `npx @kimi.builders/usage sync --full`, or confirm "Rebuild community data" in the local dashboard.',

    'sources.title': 'Data Sources:',
    'sources.mode_off': 'Off',
    'sources.mode_local': 'Local only',
    'sources.mode_private': 'Local & sync',
    'sources.tier_beta': ' (Beta)',
    'sources.tier_explicit': ' (Explicit)',
    'sources.set_success': '{sourceId} set to {mode}; remote history was not deleted.',
    'sources.enabled_success': 'Enabled {sourceId}.',
    'sources.disabled_success': 'Disabled {sourceId}; remote history was not deleted.',

    'inspect.dry_run': 'Kimi Builders Usage · dry run (offline)',
    'inspect.roots_title': 'Sources & Log Paths:',
    'inspect.not_detected': 'Not detected',
    'inspect.parsing_failed': 'Parsing failed',
    'inspect.default_upload_fields': 'Default Upload Fields:',
    'inspect.detected_result': 'Inspection Result:',
    'inspect.protocol_validation': 'Protocol Validation:',

    'status.title': '◆ Kimi Builders Usage Status',
    'status.local_engine': '[Local Data Engine]',
    'status.community_sync': '[Community Sync Service]',
    'status.quick_tips': '[Quick Commands]',
    'status.connected': 'Connected',
    'status.not_connected': 'Not connected',
    'status.sources_summary': '• Sources: {available} active · {skipped} skipped (Parsed {tokens} Tokens, {sessions} sessions)',
    'status.storage_summary': '• Storage: Snapshot {size} · Checkpoint OK',
    'status.daemon_summary': '• Background Daemon: {status}',
  },
};

let manualLocale = null;

export function detectSystemLocale(env = process.env) {
  if (manualLocale) return manualLocale;
  if (env.KBU_USAGE_LANG) {
    const lower = env.KBU_USAGE_LANG.toLowerCase();
    if (lower.startsWith('en') || lower.includes('english')) return 'en';
    if (lower.startsWith('zh') || lower.includes('chinese')) return 'zh';
  }
  const langEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || '';
  if (langEnv) {
    const lower = langEnv.toLowerCase();
    if (lower.startsWith('zh') || lower.includes('chinese') || lower.includes('zh_cn') || lower.includes('zh_tw') || lower.includes('zh_hk')) {
      return 'zh';
    }
    if (lower.startsWith('en') || lower.includes('english') || lower.includes('en_us') || lower.includes('en_gb')) {
      return 'en';
    }
  }
  if (env === process.env) {
    try {
      const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
      if (intlLocale.startsWith('zh')) return 'zh';
      if (intlLocale.startsWith('en')) return 'en';
    } catch {
      // fallback
    }
  }
  return 'zh';
}

export function setLocale(locale) {
  if (!locale) {
    manualLocale = null;
    return;
  }
  const clean = String(locale).toLowerCase();
  manualLocale = clean.startsWith('en') ? 'en' : 'zh';
}

export function getLocale() {
  return manualLocale || detectSystemLocale();
}

export function t(key, params = {}, locale = getLocale()) {
  const dict = DICTIONARY[locale] || DICTIONARY.zh;
  let template = dict[key] || DICTIONARY.zh[key] || key;
  for (const [paramKey, paramValue] of Object.entries(params)) {
    template = template.replaceAll(`{${paramKey}}`, String(paramValue ?? ''));
  }
  return template;
}
