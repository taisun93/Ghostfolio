#!/usr/bin/env node
/**
 * Converts docs/*.md to HTML. Open the HTML in a browser and use Print → Save as PDF.
 * Uses the project's existing "marked" dependency.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = __dirname;
const mdFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md') && f !== 'README.md');

const template = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    pre { background: #f4f4f4; padding: 1em; overflow-x: auto; }
    pre code { padding: 0; background: none; }
    @media print { body { max-width: none; } }
  </style>
</head>
<body>
${body}
</body>
</html>`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

for (const file of mdFiles) {
  const mdPath = path.join(docsDir, file);
  const md = fs.readFileSync(mdPath, 'utf8');
  const title = path.basename(file, '.md').replace(/-/g, ' ');
  const body = marked.parse(md, { async: false });
  const html = template(title, body);
  const outPath = path.join(docsDir, path.basename(file, '.md') + '.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Written:', outPath);
}

console.log('Open the .html file in a browser and use Print → Save as PDF.');
