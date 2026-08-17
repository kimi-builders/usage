/* 订阅/权益纯函数(20260816 自 SubscriptionLimits.jsx 拆出):
   组件文件只导出组件以恢复 Fast Refresh;测试经 vite ssrLoadModule 引用。 */
import { compactNumber, pluralUnit } from './format.js';

export const PROVIDER_TONES = {
  codex: 'blue', 'kimi-code': 'amber', warp: 'violet', 'gemini-cli': 'violet',
  antigravity: 'green', 'jetbrains-ai': 'pink', 'claude-code': 'amber', cursor: 'blue',
  copilot: 'violet', opencode: 'amber', qoder: 'green', trae: 'blue',
};

export function idSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function hasEnteredSecrets(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((entry) => hasEnteredSecrets(entry));
}

export function localizedCompact(value, zh) {
  return compactNumber(value, zh ? 'zh' : 'en');
}

export function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function limitWindowDetail(window) {
  const value = finiteNumber(window?.value);
  const limit = finiteNumber(window?.limit);
  if (value == null || limit == null) return window?.detail || null;
  return `${value.toLocaleString()} / ${limit.toLocaleString()} ${window?.unit || ''}`;
}

export function resetCreditPresentation(resetCredits, zh = false) {
  const supplied = resetCredits?.availableCount;
  const count = typeof supplied === 'number' && Number.isFinite(supplied) ? supplied : null;
  if (count == null || count < 0) return {
    state: 'unknown', value: '—', detail: zh ? '可用数量不可观测' : 'Available count is not observable',
  };
  if (count === 0) return {
    state: 'zero', value: '0', detail: zh ? '已观测到可用数量为 0' : 'Observed available count: 0',
  };
  return {
    state: 'available', value: Math.floor(count).toLocaleString(), detail: null,
  };
}

export function localizedCount(value, zh, cnUnit, singular, plural) {
  return zh ? `${value} ${cnUnit}` : `${value} ${pluralUnit(value, singular, plural)}`;
}

export const ENTITLEMENT_TYPES = ['unknown', 'paid', 'free', 'promotion', 'organization'];

export function entitlementLabel(type, zh) {
  const labels = {
    unknown: zh ? '未分类' : 'Unclassified',
    paid: zh ? '付费订阅' : 'Paid subscription',
    free: zh ? '免费额度' : 'Free allowance',
    promotion: zh ? '试用 / 活动权益' : 'Trial / promotion',
    organization: zh ? '单位 / 团队提供' : 'Organization-provided',
  };
  return labels[type] || labels.unknown;
}

/* 卡片徽标短词(20260816):权益标注并入各平台展开面板后,
   列表卡只用一枚小徽标提示当前口径,详情在展开面板里改 */
export function entitlementBadge(type, zh) {
  const badges = {
    paid: zh ? '付费' : 'Paid',
    free: zh ? '免费' : 'Free',
    promotion: zh ? '试用' : 'Trial',
    organization: zh ? '单位' : 'Org',
    unknown: zh ? '未标注' : 'Untagged',
  };
  return badges[type] || badges.unknown;
}

export function entitlementNote(type, zh) {
  if (type === 'paid') return zh ? '计入个人支出、续费与付费闲置分析。' : 'Included in personal spend, renewal, and paid-idle analysis.';
  if (type === 'free') return zh ? '保留 Token 价值分析，不计入个人支出。' : 'Usage value remains visible without entering personal spend.';
  if (type === 'promotion') return zh ? '适合记录试用、赠送和限时活动额度。' : 'For trials, grants, and time-limited promotional allowances.';
  if (type === 'organization') return zh ? '由单位或团队承担，不计入个人支出。' : 'Paid by an organization or team, not personal spend.';
  return zh ? '未分类不会被当成免费、付费或无限。' : 'Unclassified is never assumed free, paid, or unlimited.';
}
