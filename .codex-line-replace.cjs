const fs = require('fs');
const { spawnSync } = require('child_process');

const [file, encoded] = process.argv.slice(2);
const replacements = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const original = fs.readFileSync(file, 'utf8');
let updated = original;
for (const replacement of replacements) {
  if (Array.isArray(replacement)) {
    const [before, after] = replacement;
    if (!updated.includes(before)) throw new Error(`Missing source text: ${before.slice(0, 80)}`);
    updated = updated.replace(before, after);
  } else {
    const expression = new RegExp(replacement.pattern, replacement.flags ?? '');
    if (!expression.test(updated)) throw new Error(`Missing source pattern: ${replacement.pattern.slice(0, 80)}`);
    updated = updated.replace(expression, replacement.after);
  }
}
if (updated === original) process.exit(0);
const oldLines = original.split(/\r?\n/);
const newLines = updated.split(/\r?\n/);
let start = 0;
while (start < oldLines.length && oldLines[start] === newLines[start]) start += 1;
let oldEnd = oldLines.length - 1;
let newEnd = newLines.length - 1;
while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) { oldEnd -= 1; newEnd -= 1; }
const beforeContext = oldLines.slice(Math.max(0, start - 2), start);
const afterContext = oldLines.slice(oldEnd + 1, oldEnd + 3);
const patch = ['*** Begin Patch', `*** Update File: ${file.replace(/\\/g, '/')}`, '@@', ...beforeContext.map(line => ` ${line}`), ...oldLines.slice(start, oldEnd + 1).map(line => `-${line}`), ...newLines.slice(start, newEnd + 1).map(line => `+${line}`), ...afterContext.map(line => ` ${line}`), '*** End Patch'].join('\n');
const binary = 'C:/Users/neo/.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64/bin/windows-x86_64/codex.exe';
const result = spawnSync(binary, ['--codex-run-as-apply-patch', patch], { stdio: 'inherit' });
process.exit(result.status ?? 1);
