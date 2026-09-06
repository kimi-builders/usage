import { piSessionRoots } from '../pi-roots.js';
import { parsePiSessions } from './pi-session-jsonl.js';

export function roots({ sourceOptions } = {}) {
  return piSessionRoots(sourceOptions);
}

export async function parse({ sessionSalt, sourceOptions } = {}) {
  const scanRoots = roots({ sourceOptions });
  if (!scanRoots.length) return null;
  return parsePiSessions({ source: 'pi-coding-agent', roots: scanRoots, sessionSalt });
}
