// Presentation only: never change model IDs used for grouping, pricing or attribution.
const LABELS = new Map([
  ['mimo-v2.6-pro', 'MiMo V2.6 Pro'],
  ['mimo-v2.6-flash', 'MiMo V2.6 Flash'],
  ['mimo-v2.6-pro-ultraspeed', 'MiMo V2.6 Pro UltraSpeed'],
  ['step-5-preview', 'Step 5 Preview'],
  ['step-3.7-flash', 'Step 3.7 Flash'],
  ['step-3.5-flash', 'Step 3.5 Flash'],
  ['step-3.5-flash-2603', 'Step 3.5 Flash 2603'],
  ['step-1o-turbo-vision', 'Step 1o Turbo Vision'],
  ['stepaudio-3-realtime-preview', 'StepAudio 3 Realtime Preview'],
  ['stepaudio-3-chat-preview', 'StepAudio 3 Chat Preview'],
]);

function modelId(identity) {
  const value = typeof identity === 'string' ? identity : identity?.modelCanonical || identity?.model;
  return typeof value === 'string' ? value.trim() : '';
}

function slug(identity) {
  return modelId(identity).split('/').at(-1).toLowerCase().replace(/[\s_]+/g, '-');
}

export function modelDisplayName(identity) {
  return LABELS.get(slug(identity)) || modelId(identity) || 'unknown';
}

export function modelGlyphId(identity) {
  // Model vendor, not the Agent or API reseller; unknown models have no mark.
  const id = slug(identity);
  if (/^mimo-v\d/.test(id)) return 'xiaomimimo';
  if (/^(?:step-(?:\d|audio-|tts-|asr|image-)|stepaudio-\d)/.test(id)) return 'stepfun';
  return '';
}
