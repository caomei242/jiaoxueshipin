export function splitLines(text, maxChars = 18) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const lines = [];
  let current = '';
  for (const char of clean) {
    current += char;
    if (current.length >= maxChars || /[，。；？！]/.test(char)) {
      lines.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.slice(0, 4);
}

export function estimateDuration(text, min = 4.5, max = 9) {
  const len = String(text || '').replace(/\s+/g, '').length;
  return Math.max(min, Math.min(max, Number((len / 7.5).toFixed(1))));
}

export function formatSrtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}
