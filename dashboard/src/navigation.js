export const USAGE_SECTION_IDS = ['top', 'trend', 'activity', 'distribution', 'records'];
export const BENEFIT_SECTION_IDS = [
  'subscriptions',
  'subscription-accounts',
  'subscription-trend',
  'subscription-activity',
  'subscription-distribution',
  'subscription-records',
];
export const LOCAL_SECTION_IDS = [...USAGE_SECTION_IDS, ...BENEFIT_SECTION_IDS, 'sources'];

export const SECTION_TITLES = Object.freeze({
  top: { zh: '用量总览', en: 'Usage Overview' },
  trend: { zh: '用量趋势', en: 'Usage Trends' },
  activity: { zh: '用量活跃', en: 'Usage Activity' },
  distribution: { zh: '用量分布', en: 'Usage Distribution' },
  records: { zh: '用量明细', en: 'Usage Records' },
  subscriptions: { zh: '权益总览', en: 'Benefit Overview' },
  'subscription-accounts': { zh: '账户权益', en: 'Account Benefits' },
  'subscription-trend': { zh: '权益趋势', en: 'Benefit Trends' },
  'subscription-activity': { zh: '权益活跃', en: 'Benefit Activity' },
  'subscription-distribution': { zh: '权益分布', en: 'Benefit Distribution' },
  'subscription-records': { zh: '权益明细', en: 'Benefit Records' },
  sources: { zh: '本机与数据源', en: 'Device & Data Sources' },
});

export function isBenefitSection(id) {
  return BENEFIT_SECTION_IDS.includes(id);
}

export function isStandaloneSection(id) {
  return isBenefitSection(id) || id === 'sources';
}

export function sectionFromHash(hash = '') {
  const raw = String(hash).replace(/^#/, '');
  const id = raw === 'limits' ? 'subscriptions' : raw;
  return LOCAL_SECTION_IDS.includes(id) ? id : 'top';
}

export function titleForSection(section, locale = 'zh') {
  const normalized = sectionFromHash(`#${section || ''}`);
  const label = SECTION_TITLES[normalized]?.[locale === 'en' ? 'en' : 'zh'] || SECTION_TITLES.top.zh;
  return `${label} — kimi.builders · Local`;
}
