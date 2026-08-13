import { piSessionRoots } from '../pi-roots.js';
import { parsePiSessions } from './pi-session-jsonl.js';

export function roots() {
  return piSessionRoots();
}

export async function parse({ sessionSalt } = {}) {
  const scanRoots = roots();
  if (!scanRoots.length) return null;
  return parsePiSessions({ source: 'pi-coding-agent', roots: scanRoots, sessionSalt });
}
