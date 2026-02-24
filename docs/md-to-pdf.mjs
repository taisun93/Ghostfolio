#!/usr/bin/env node
/**
 * Converts all .md files in docs/ to PDF using:
 * 1. marked → HTML
 * 2. Edge (or Chrome) --headless --print-to-pdf
 * No Puppeteer/Chromium download required on Windows.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = __dirname;

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe');
const browserPath = fs.existsSync(edgePath) ? edgePath : (fs.existsSync(chromePath) ? chromePath : null);

if (!browserPath) {
  console.error('Neither Edge nor Chrome found. Install one or use: node docs/md-to-html.mjs then open the .html in a browser and Print → Save as PDF.');
  process.exit(1);
}

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

const mdFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md') && !f.startsWith('README'));

for (const file of mdFiles) {
  const base = path.basename(file, '.md');
  const mdPath = path.join(docsDir, file);
  const htmlPath = path.join(docsDir, base + '.html');
  const pdfPath = path.join(docsDir, base + '.pdf');

  const md = fs.readFileSync(mdPath, 'utf8');
  const title = base.replace(/-/g, ' ');
  const body = marked.parse(md, { async: false });
  const html = template(title, body);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const htmlUri = 'file:///' + htmlPath.replace(/\\/g, '/');
  const pdfArg = pdfPath.replace(/\\/g, '/');
  execSync(
    `"${browserPath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfArg}" "${htmlUri}"`,
    { stdio: 'inherit', timeout: 15000 }
  );
  console.log('PDF:', pdfPath);
}

console.log('Done. PDFs are in docs/');
