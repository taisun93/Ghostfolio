#!/usr/bin/env node
/**
 * Run AI chat golden set + Finance tools tests and write results to
 * src/app/endpoints/ai/AI_CHAT_TEST_RESULTS_10.md
 *
 * Runs both:
 *   - src/app/endpoints/ai/ai-chat.service.spec.ts (AI chat)
 *   - src/app/tools/tools.service.spec.ts (Finance tools)
 *
 * Usage: from repo root or apps/api:
 *   npx dotenv-cli -e .env.example -- node apps/api/scripts/run-ai-chat-tests-and-report.mjs
 *   cd apps/api && node scripts/run-ai-chat-tests-and-report.mjs
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '..');
const MD_PATH = path.join(API_ROOT, 'src', 'app', 'endpoints', 'ai', 'AI_CHAT_TEST_RESULTS_10.md');

// Give Jest more heap to avoid OOM during AI chat tests
const prev = process.env.NODE_OPTIONS || '';
if (!prev.includes('max-old-space-size')) {
  process.env.NODE_OPTIONS = (prev + ' --max-old-space-size=4096').trim();
}

const quick = process.env.QUICK === '1' || process.env.QUICK === 'true';
const jestArgs = [
  'jest',
  'src/app/endpoints/ai/ai-chat.service.spec.ts',
  'src/app/tools/tools.service.spec.ts',
  '--no-cache',
  '--verbose'
];
if (quick) {
  jestArgs.push('--testNamePattern', 'Config');
}

const outFile = path.join(API_ROOT, `jest-out-${process.pid}.txt`);
const jsonFile = path.join(API_ROOT, 'ai-chat-results.json');
const jestArgsWithJson = [...jestArgs, '--json', '--outputFile=ai-chat-results.json'];
let exitCode = 0;
let fullOutput = '';
try {
  const cmd = jestArgsWithJson.join(' ');
  execSync(`npx ${cmd} > "${outFile}" 2>&1`, { cwd: API_ROOT, shell: true, maxBuffer: 50 * 1024 * 1024 });
} catch (e) {
  exitCode = e.status ?? 1;
}
try {
  fullOutput = fs.readFileSync(outFile, 'utf8');
  process.stdout.write(fullOutput);
} catch (_) {}
try { fs.unlinkSync(outFile); } catch (_) {}

// Prefer JSON results if Jest wrote them
let dataFromJson = null;
try {
  const raw = fs.readFileSync(jsonFile, 'utf8');
  const parsed = JSON.parse(raw);
  dataFromJson = Array.isArray(parsed) ? { testResults: parsed } : parsed;
  if (!dataFromJson.testResults && parsed.testResults) dataFromJson = parsed;
} catch (_) {}
try { fs.unlinkSync(jsonFile); } catch (_) {}
const jestResult = { status: exitCode };
const stdout = fullOutput;
const stderr = '';

let data = dataFromJson;
if (!data || !data.testResults?.length) {
  const testsSummary = fullOutput.match(/Tests:\s*(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?[,\s]*(?:(\d+)\s+total)?/i);
  const numPassed = testsSummary ? parseInt(testsSummary[1] || '0', 10) : parseInt(fullOutput.match(/(\d+)\s+passed/)?.[1] || '0', 10);
  const numFailed = testsSummary ? parseInt(testsSummary[2] || '0', 10) : parseInt(fullOutput.match(/(\d+)\s+failed/)?.[1] || '0', 10);
  const numSkipped = testsSummary ? parseInt(testsSummary[3] || '0', 10) : parseInt(fullOutput.match(/(\d+)\s+skipped/)?.[1] || '0', 10);
  const hasSummary = numPassed + numFailed + numSkipped > 0 || fullOutput.includes('Test Suites:') || fullOutput.includes('Tests:');
  if (hasSummary) {
    const assertionResults = [];
    const lineRe = /^\s*[✓✔]\s+(.+)$|^\s*[✕✖]\s+(.+)$|^\s*○\s+skipped\s+(.+)$/gm;
    let m;
    const seen = new Set();
    while ((m = lineRe.exec(fullOutput)) !== null) {
      const raw = (m[1] || m[2] || m[3] || '').trim();
      const title = raw.includes('›') ? raw.split('›').pop().trim() : raw;
      if (!title || seen.has(title)) continue;
      seen.add(title);
      assertionResults.push({
        ancestorTitles: raw.includes('›') ? raw.split('›').slice(0, -1).map((s) => s.trim()) : [],
        title,
        status: m[3] ? 'pending' : m[2] ? 'failed' : 'passed',
        failureMessages: []
      });
    }
    data = {
      numPassedTests: numPassed,
      numFailedTests: numFailed,
      numPendingTests: numSkipped,
      testResults: [{ assertionResults }]
    };
  }
}

// exitCode already set above from execSync

function statusLabel(s) {
  if (s === 'passed') return 'Pass';
  if (s === 'failed') return 'Fail';
  if (s === 'pending' || s === 'skipped') return 'Skipped';
  return s;
}

function buildMarkdown(quickMode = false) {
  const lines = [];
  const allResults = data?.testResults ?? [];
  const flatAssertions = allResults.flatMap((suite) => {
    const file = suite.name ?? '';
    const shortName = path.basename(file);
    return (suite.assertionResults || []).map((a) => ({ ...a, _suite: shortName }));
  });
  const totalTests = flatAssertions.length;
  const testCountLabel = totalTests > 0 ? ` (${totalTests} tests)` : '';
  lines.push(`# AI Chat + Tools Test Results${testCountLabel}`);
  lines.push('');
  lines.push('## Status');
  lines.push('');

  if (!data || !Array.isArray(data.testResults) || data.testResults.length === 0) {
    lines.push('**Fail** — Suite did not run or no results (compile error, crash, or OOM).');
    lines.push('');
    lines.push(`Exit code: ${exitCode}`);
    const errText = [stderr, stdout].join('\n').trim();
    if (errText) {
      lines.push('');
      lines.push('## Errors');
      lines.push('');
      lines.push('```');
      lines.push(errText.slice(0, 4000));
      lines.push('```');
    }
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push('- Run from repo root: `node apps/api/scripts/run-ai-chat-tests-and-report.mjs`');
    lines.push('- Or from apps/api: `node scripts/run-ai-chat-tests-and-report.mjs`');
    return lines.join('\n');
  }

  const anyMessage = allResults.map((s) => s.message).filter(Boolean).join('\n');
  if (flatAssertions.length === 0 && (anyMessage || exitCode !== 0)) {
    lines.push('**Fail** — Suite failed to run or no tests executed.');
    lines.push('');
    lines.push(`Exit code: ${exitCode}`);
    if (anyMessage) {
      lines.push('');
      lines.push('## Errors');
      lines.push('');
      lines.push('```');
      lines.push(anyMessage.slice(0, 4000));
      lines.push('```');
    }
    lines.push('');
    lines.push('## Notes');
    lines.push('- Run from repo root: `node apps/api/scripts/run-ai-chat-tests-and-report.mjs`');
    return lines.join('\n');
  }

  const numPassed = data.numPassedTests ?? flatAssertions.filter((a) => a.status === 'passed').length;
  const numFailed = data.numFailedTests ?? flatAssertions.filter((a) => a.status === 'failed').length;
  const numPending = data.numPendingTests ?? flatAssertions.filter((a) => a.status === 'pending' || a.status === 'skipped').length;

  let status = '**Pass**';
  if (numFailed > 0) status = '**Fail**';
  else if (numPending > 0 && numPassed > 0) status = '**Partial**';
  else if (numPassed === 0 && numPending > 0) status = '**Partial** (all LLM tests skipped if no OPENAI_API_KEY)';

  lines.push(`${status} — ${numPassed} passed, ${numFailed} failed, ${numPending} skipped.`);
  lines.push('');
  lines.push(`Exit code: ${exitCode}`);
  lines.push('');
  lines.push('## Tests run');
  lines.push('');
  lines.push('| # | Suite | Describe block | Test | Result |');
  lines.push('|---|-------|----------------|------|--------|');

  flatAssertions.forEach((a, i) => {
    const describeBlock = (a.ancestorTitles && a.ancestorTitles.length > 0) ? a.ancestorTitles[a.ancestorTitles.length - 1] : '';
    const result = statusLabel(a.status);
    const title = (a.title || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const suiteName = a._suite ?? '';
    lines.push(`| ${i + 1} | ${suiteName} | ${describeBlock} | ${title} | ${result} |`);
  });

  const failures = flatAssertions.filter((a) => a.status === 'failed' && a.failureMessages && a.failureMessages.length > 0);
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Errors');
    lines.push('');
    failures.forEach((a) => {
      lines.push(`### ${(a.ancestorTitles || []).concat([a.title]).join(' > ')}`);
      lines.push('');
      const msg = (a.failureMessages || []).join('\n').slice(0, 2000);
      lines.push('```');
      lines.push(msg);
      lines.push('```');
      lines.push('');
    });
  }

  lines.push('## Notes');
  lines.push('');
  lines.push(`- **Scope:** \`ai-chat.service.spec.ts\` (AI chat) + \`tools.service.spec.ts\` (Finance tools). Total: ${totalTests} tests.`);
  lines.push('- **Command:** `npx jest src/app/endpoints/ai/ai-chat.service.spec.ts src/app/tools/tools.service.spec.ts --no-cache` from `apps/api`.');
  lines.push('- **Env:** Repo root `.env` is loaded in `test-setup.ts`; `OPENAI_API_KEY` or `API_KEY_OPENAI` is used for AI chat LLM tests when present.');
  lines.push('- To regenerate: `npm run test:ai-chat:report` (from repo root). If you see out-of-memory locally, run the **AI Chat Test Report** workflow from the Actions tab (runs with 8GB heap on GitHub).');
  if (quickMode) {
    lines.push('- **Quick run:** only Config and Input tests were run (set `QUICK=1` for this).');
  }

  return lines.join('\n');
}

const md = buildMarkdown(quick);
fs.mkdirSync(path.dirname(MD_PATH), { recursive: true });
fs.writeFileSync(MD_PATH, md, 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), MD_PATH)}`);
process.exit(exitCode);
