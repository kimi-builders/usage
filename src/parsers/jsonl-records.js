import { createReadStream, statSync } from 'node:fs';

// Bound reads to the initial file size so an actively appended log terminates.
// Retain only one JSON line; never include its contents/path in diagnostics.
export async function* jsonlRecords(path, warn, { maxLineBytes = 16 * 1024 * 1024 } = {}) {
  let pending = '';
  let pendingBytes = 0;
  let dropping = false;
  const decode = (line) => {
    if (!line.trim()) return null;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* A truncated record must not discard healthy neighbors. */ }
    warn('invalid or incomplete JSON record; healthy records retained');
    return null;
  };
  try {
    const size = statSync(path).size;
    if (!size) return;
    for await (const chunk of createReadStream(path, { encoding: 'utf8', end: size - 1, highWaterMark: 64 * 1024 })) {
      const parts = chunk.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (!dropping) {
          pending += parts[index];
          pendingBytes += Buffer.byteLength(parts[index]);
          if (pendingBytes > maxLineBytes) {
            pending = ''; pendingBytes = 0; dropping = true;
            warn('JSON record exceeds the bounded reader limit; healthy records retained');
          }
        }
        if (index < parts.length - 1) {
          if (!dropping) { const value = decode(pending); if (value) yield value; }
          pending = ''; pendingBytes = 0; dropping = false;
        }
      }
    }
    if (!dropping) { const value = decode(pending); if (value) yield value; }
  } catch { warn('cannot read a session file; healthy records retained'); }
}
