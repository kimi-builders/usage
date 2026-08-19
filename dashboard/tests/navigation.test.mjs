import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENEFIT_SECTION_IDS,
  isBenefitSection,
  isStandaloneSection,
  LOCAL_SECTION_IDS,
  sectionFromHash,
  titleForSection,
  USAGE_SECTION_IDS,
} from '../src/navigation.js';

test('every supported dashboard deep link survives hash parsing', () => {
  for (const id of LOCAL_SECTION_IDS) assert.equal(sectionFromHash(`#${id}`), id);
  assert.deepEqual(USAGE_SECTION_IDS, ['top', 'trend', 'activity', 'distribution', 'records']);
  assert.deepEqual(BENEFIT_SECTION_IDS, [
    'subscriptions', 'subscription-accounts', 'subscription-trend', 'subscription-activity', 'subscription-distribution', 'subscription-records',
  ]);
});

test('legacy and invalid hashes resolve without inventing a page', () => {
  assert.equal(sectionFromHash('#limits'), 'subscriptions');
  assert.equal(sectionFromHash('#unknown'), 'top');
  assert.equal(sectionFromHash(''), 'top');
});

test('standalone pages are separated from scroll-spied usage sections', () => {
  for (const id of BENEFIT_SECTION_IDS) {
    assert.equal(isBenefitSection(id), true);
    assert.equal(isStandaloneSection(id), true);
  }
  assert.equal(isStandaloneSection('sources'), true);
  for (const id of USAGE_SECTION_IDS) assert.equal(isStandaloneSection(id), false);
});

test('builds localized document titles for routes and the legacy limits hash', () => {
  assert.equal(titleForSection('top', 'zh'), '用量总览 — kimi.builders · Local');
  assert.equal(titleForSection('subscription-trend', 'zh'), '权益趋势 — kimi.builders · Local');
  assert.equal(titleForSection('subscription-accounts', 'zh'), '账号 — kimi.builders · Local');
  assert.equal(titleForSection('subscription-distribution', 'en'), 'Benefit Distribution — kimi.builders · Local');
  assert.equal(titleForSection(sectionFromHash('#limits'), 'en'), 'Benefit Overview — kimi.builders · Local');
});
