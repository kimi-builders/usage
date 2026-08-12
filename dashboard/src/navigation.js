export const USAGE_SECTION_IDS = ['top', 'trend', 'activity', 'distribution', 'records'];
export const BENEFIT_SECTION_IDS = [
  'subscriptions',
  'subscription-trend',
  'subscription-activity',
  'subscription-distribution',
  'subscription-records',
];
export const LOCAL_SECTION_IDS = [...USAGE_SECTION_IDS, ...BENEFIT_SECTION_IDS, 'sources'];

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

