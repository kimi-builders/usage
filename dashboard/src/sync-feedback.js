import { sourceLabel } from './format.js';

export function formatSyncDuration(milliseconds, zh) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1_000));
  if (seconds < 60) return zh ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return zh ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
}

export function buildSyncOutcome(result = {}, zh = false) {
  const buckets = Number(result.buckets || 0);
  const sessions = Number(result.sessions || 0);
  const rejected = Number(result.rejected || 0);
  const changed = buckets + sessions;
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const problemSources = sources.filter((source) => ['failed', 'partial'].includes(source.status));
  const completedSources = sources.filter((source) => source.status === 'ok').length;
  const skippedSources = sources.filter((source) => source.status === 'skipped').length;
  const sourceNames = problemSources.slice(0, 3).map((source) => sourceLabel(source.source)).join(zh ? '、' : ', ');
  const more = Math.max(0, problemSources.length - 3);
  const base = changed
    ? (zh ? `已上传 ${buckets} 个 buckets、${sessions} 个 sessions。` : `Uploaded ${buckets} buckets and ${sessions} sessions.`)
    : (zh ? '扫描完成，没有新增或变化的用量需要上传。' : 'Scan complete. No new or changed usage needed uploading.');
  const details = sources.length
    ? (zh
      ? `检查 ${sources.length} 个 Agent · ${completedSources} 个完成${skippedSources ? ` · ${skippedSources} 个无本地数据` : ''}`
      : `Checked ${sources.length} agents · ${completedSources} complete${skippedSources ? ` · ${skippedSources} without local data` : ''}`)
    : '';

  if (problemSources.length) {
    return {
      tone: 'warning',
      title: zh ? '部分同步完成' : 'Sync partially completed',
      text: `${base} ${zh
        ? `${sourceNames}${more ? ` 等 ${problemSources.length} 个来源` : ''}读取不完整，社区中的旧数据已保留。`
        : `${sourceNames}${more ? ` and ${more} more` : ''} could not be fully read; their previous community data was preserved.`}`,
      details,
    };
  }
  if (rejected > 0) {
    return {
      tone: 'warning',
      title: zh ? '同步完成，有记录被隔离' : 'Sync completed with isolated records',
      text: `${base} ${zh ? `${rejected} 条异常记录已隔离。` : `${rejected} invalid records were isolated.`}`,
      details,
    };
  }
  return {
    tone: 'success',
    title: changed ? (zh ? '同步成功' : 'Sync successful') : (zh ? '同步完成' : 'Sync complete'),
    text: base,
    details,
  };
}
