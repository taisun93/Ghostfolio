import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'path';
import { replaceInFileSync } from 'replace-in-file';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: resolve(__dirname, '.env')
});

const now = new Date();
const buildTimestamp = `${formatWithTwoDigits(
  now.getDate()
)}.${formatWithTwoDigits(
  now.getMonth() + 1
)}.${now.getFullYear()} ${formatWithTwoDigits(
  now.getHours()
)}:${formatWithTwoDigits(now.getMinutes())}`;

const SUPPORTED_LANGUAGE_CODES = [
  'ca',
  'de',
  'en',
  'es',
  'fr',
  'it',
  'ko',
  'nl',
  'pl',
  'pt',
  'tr',
  'uk',
  'zh'
];

try {
  const changedFiles = replaceInFileSync({
    files: './dist/apps/client/main.*.js',
    from: /{BUILD_TIMESTAMP}/g,
    to: buildTimestamp,
    allowEmptyPaths: false
  });
  console.log('Build version set: ' + buildTimestamp);
  console.log(changedFiles);
} catch (error) {
  console.error('Error occurred:', error);
}

const rootUrl = process.env.ROOT_URL || 'https://ghostfol.io';
const currentDate = now.toISOString().slice(0, 10);

for (const languageCode of SUPPORTED_LANGUAGE_CODES) {
  const indexPath = resolve(
    __dirname,
    'dist',
    'apps',
    'client',
    languageCode,
    'index.html'
  );
  try {
    let html = readFileSync(indexPath, 'utf8');
    html = html
      .replace(/\$\{languageCode\}/g, languageCode)
      .replace(/\$\{rootUrl\}/g, rootUrl)
      .replace(/\$\{currentDate\}/g, currentDate)
      .replace(/\$\{path\}/g, `/${languageCode}/`)
      .replace(/\$\{featureGraphicPath\}/g, 'assets/cover.png')
      .replace(/\$\{title\}/g, 'Ghostfolio')
      .replace(/\$\{description\}/g, 'Open Source Wealth Management Software')
      .replace(/\$\{keywords\}/g, 'wealth management, portfolio tracker');
    writeFileSync(indexPath, html);
    console.log('Replaced placeholders in', indexPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('Skip (no file):', indexPath);
    } else {
      console.error('Error processing', indexPath, err);
    }
  }
}

function formatWithTwoDigits(aNumber) {
  return aNumber < 10 ? '0' + aNumber : aNumber;
}
