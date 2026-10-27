import { Buffer } from 'node:buffer';
import { ADB_MAGIC, BROADCAST_TEXT_TABLE } from '../../src/shared/types';

/** Ein Umschlag wie vom Addon (wie tests/helpers.py envelope). */
export function envelope(n: number, source = 'quests', text?: string): string {
  const title = source === 'quests' ? `Quest ${n}` : `Buch ${n}`;
  const key = source === 'quests' ? 'title' : 'book';
  const body = text ?? `Text ${n} mit Ümläuten, "Zitat" und \\Backslash`;
  return `!SPOKEN1 ${source}\nquest=${n}\nevent=progress\nnpc=${n} Händler ${n}\n${key}=${title}\n` +
    `text<<\n${body}\n>>\nsum=${n}\n`;
}

export function luaString(text: string): string {
  return '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n') + '"';
}

/** SpokenContributions.lua wie WoW sie schreibt (unter Windows/Wine mit CRLF). */
export function contributionsLua(envelopes: readonly string[], options: { crlf?: boolean; flags?: boolean; indent?: string } = {}): Buffer {
  const { crlf = true, flags = true, indent = '' } = options;
  const lines = ['', 'SpokenContributionsDB = {'];
  if (flags) lines.push(`${indent}["Enabled"] = true,`);
  lines.push(`${indent}["Lines"] = {`);
  envelopes.forEach((env, i) => {
    lines.push('{', `["key"] = "k${i}",`, `["envelope"] = ${luaString(env)},`, '},');
  });
  lines.push('},');
  if (flags) lines.push(`${indent}["Introduced"] = false,`);
  lines.push('}', '');
  return Buffer.from(lines.join(crlf ? '\r\n' : '\n'), 'utf8');
}

/** DBCache.bin mit BroadcastText-Einträgen (id, männlich, weiblich). */
export function dbcache(build: number, rows: readonly (readonly [number, string, string])[], status = 1, table = BROADCAST_TEXT_TABLE): Buffer {
  const head = Buffer.alloc(44);
  head.writeUInt32LE(ADB_MAGIC, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(build, 8);
  const parts: Buffer[] = [head];
  for (const [id, text, text1] of rows) {
    const data = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0]), Buffer.from(text1, 'utf8'), Buffer.from([0]), Buffer.alloc(8)]);
    const entry = Buffer.alloc(32);
    entry.writeUInt32LE(ADB_MAGIC, 0);
    entry.writeUInt32LE(table, 16);
    entry.writeUInt32LE(id, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt32LE(status, 28);
    parts.push(entry, data);
  }
  return Buffer.concat(parts);
}
