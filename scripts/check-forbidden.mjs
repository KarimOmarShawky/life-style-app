#!/usr/bin/env node
/**
 * scripts/check-forbidden.mjs
 *
 * Implements ADR-039: Forbidden-dependency guard for out-of-scope technology.
 * This CI guard fails the build if any forbidden dependencies, container images,
 * environment variables, or packages appear in project configuration or code.
 *
 * False positives or authorized testing tools are managed strictly via
 * scripts/forbidden-allowlist.json per ADR-039.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Categorized forbidden rules per ADR-039 & Spec §2.2
const FORBIDDEN_RULES = [
  {
    category: 'MongoDB (ADR-001, D-02)',
    tokens: ['mongoose', 'mongodb', 'MONGODB_URI', 'MONGO_URL'],
    patterns: [
      /\bmongoose\b/i,
      /\bmongodb\b/i,
      /\bmongo:[\w.-]+/i,
      /\bimage:\s*mongo\b/i,
      /\bMONGODB_URI\b/i,
      /\bMONGO_URL\b/i
    ]
  },
  {
    category: 'Cookie/Session Authentication (ADR-003, D-05)',
    tokens: ['cookie-parser', 'express-session', 'csurf', 'cookie-session', 'COOKIE_SECRET'],
    patterns: [
      /\bcookie-parser\b/i,
      /\bexpress-session\b/i,
      /\bcsurf\b/i,
      /\bcookie-session\b/i,
      /\bCOOKIE_SECRET\b/i
    ]
  },
  {
    category: 'Server File Storage / Multipart Parsing (D-08; local audio clarification)',
    tokens: ['multer', 'busboy', 'formidable', '@aws-sdk/client-s3', 'file_picker', 'image_picker'],
    patterns: [
      /\bmulter\b/i,
      /\bbusboy\b/i,
      /\bformidable\b/i,
      /@aws-sdk\/client-s3/i,
      /\bfile_picker\b/i,
      /\bimage_picker\b/i
    ]
  },
  {
    category: 'AI / LLM Frameworks (D-07)',
    tokens: ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'langchain'],
    patterns: [
      /\bopenai\b/i,
      /@anthropic-ai\/sdk/i,
      /@google\/generative-ai/i,
      /\blangchain\b/i
    ]
  },
  {
    category: 'Offline-First Local DBs (D-10)',
    tokens: ['drift', 'sqflite', 'isar', 'hive', 'floor', 'objectbox'],
    patterns: [
      /\bdrift\b/i,
      /\bsqflite\b/i,
      /\bisar\b/i,
      /\bhive\b/i,
      /\bfloor\b/i,
      /\bobjectbox\b/i
    ]
  },
  {
    category: 'Voice / Widgets (Roadmap R3)',
    tokens: ['speech_to_text', 'home_widget'],
    patterns: [
      /\bspeech_to_text\b/i,
      /\bhome_widget\b/i
    ]
  }
];

// Files to scan
const FILES_TO_SCAN = [
  'package.json',
  'package-lock.json',
  'backend/package.json',
  'backend/package-lock.json',
  'mobile-app/mobile/pubspec.yaml',
  'mobile-app/mobile/pubspec.lock',
  'docker/docker-compose.yml',
  'docker/Dockerfile',
  'docker-compose.yml',
  '.env.example',
  'backend/.env.example'
];

// Owner clarification 2026-10-15: local focus audio is allowed; server uploads
// remain forbidden. No global file_picker allowlist: authorize only these exact
// manifest/lock entries and the existing audio-only Dart consumer.
const mobileManifest = 'mobile-app/mobile/pubspec.yaml';
const mobileLock = 'mobile-app/mobile/pubspec.lock';
const localAudioScreen = 'mobile-app/mobile/lib/features/timer/presentation/focus_timer_screen.dart';

function localPickerLines(relPath, lines) {
  const permitted = new Set();
  if (relPath === mobileManifest) {
    let dependencies = false;
    lines.forEach((line, index) => {
      if (/^dependencies:\s*$/.test(line)) dependencies = true;
      else if (/^\S/.test(line) && !line.startsWith('#')) dependencies = false;
      if (dependencies && /^  file_picker: \^13\.1\.0\s*$/.test(line)) permitted.add(index);
    });
  } else if (relPath === mobileLock) {
    const start = lines.findIndex((line) => line === '  file_picker:');
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !/^  [a-zA-Z0-9_]+:/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
      const block = lines.slice(start, end);
      if (block.includes('    dependency: "direct main"') && block.includes('    source: hosted') &&
          block.includes('    version: "13.1.0"')) {
        permitted.add(start);
        block.forEach((line, offset) => { if (line === '      name: file_picker') permitted.add(start + offset); });
      }
    }
  }
  return permitted;
}

// Pure inspection entry points are for synthetic negative tests. The CLI always
// reads its real repository root; no environment/argument can select a clean root.
export function inspectForbiddenFile(relPath, content, allowlistedNames = []) {
  const lines = content.split('\n'), permitted = localPickerLines(relPath, lines), violations = [];
  lines.forEach((line, index) => {
    for (const rule of FORBIDDEN_RULES) {
      rule.patterns.forEach((pattern, patternIndex) => {
        const token = rule.tokens[patternIndex];
        if (!pattern.test(line)) return;
        if (token === 'file_picker') {
          if (permitted.has(index)) return;
        } else if (token && allowlistedNames.includes(token.toLowerCase())) return;
        violations.push({ file: relPath, line: index + 1, category: rule.category });
      });
    }
  });
  if (relPath === 'backend/package.json') {
    const pkg = JSON.parse(content);
    for (const dependency of Object.keys(pkg.dependencies || {})) {
      const rule = FORBIDDEN_RULES.find((rule) => rule.tokens.some((token) => dependency.toLowerCase() === token.toLowerCase()));
      if (rule) violations.push({ file: relPath, line: 1, category: `Production dependency: ${rule.category}` });
    }
  }
  return violations;
}

export function inspectLocalPickerSource(relPath, content) {
  const imports = [...content.matchAll(/(?:import|export)\s+['"]package:((?:file_picker[^/]*|android_file_picker|windows_file_picker))\/[^'"]+['"][^;]*;/g)];
  const calls = [...content.matchAll(/\bFilePicker\s*\.\s*\w+\s*\(/g)];
  const violations = [];
  for (const match of imports) {
    if (relPath !== localAudioScreen || match[0] !== "import 'package:file_picker/file_picker.dart';") {
      violations.push({ file: relPath, line: content.slice(0, match.index).split('\n').length, category: 'Unapproved local picker consumer' });
    }
  }
  if (calls.length && (relPath !== localAudioScreen || calls.length !== 1 ||
      !/\bFilePicker\.pickFile\(type: FileType\.audio\)/.test(content))) {
    violations.push({ file: relPath, line: 1, category: 'Only the existing local audio picker call is approved' });
  }
  return violations;
}

function main() {
  console.log('🔍 Running ADR-039 Forbidden-Dependency Guard...');
  let allowlistedNames = [];
  const allowlistPath = path.join(__dirname, 'forbidden-allowlist.json');
  if (fs.existsSync(allowlistPath)) {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    allowlistedNames = (raw.allowlist || []).map((item) => item.dependency.toLowerCase());
  }
  const violations = [];
  for (const relPath of FILES_TO_SCAN) {
    const fullPath = path.join(rootDir, relPath);
    if (fs.existsSync(fullPath)) violations.push(...inspectForbiddenFile(relPath, fs.readFileSync(fullPath, 'utf8'), allowlistedNames));
  }
  function walk(relativeDirectory) {
    for (const entry of fs.readdirSync(path.join(rootDir, relativeDirectory), { withFileTypes: true })) {
      const relativeFile = `${relativeDirectory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Cannot verify symlinked mobile source');
      if (entry.isDirectory()) walk(relativeFile);
      else if (entry.isFile() && entry.name.endsWith('.dart')) {
        violations.push(...inspectLocalPickerSource(relativeFile, fs.readFileSync(path.join(rootDir, relativeFile), 'utf8')));
      }
    }
  }
  walk('mobile-app/mobile/lib');
  for (const violation of violations) {
    // Metadata only: configuration lines can contain credentials; never echo them.
    console.error(`❌ [VIOLATION] ${violation.category} at ${violation.file}:${violation.line}`);
  }
  if (violations.length) {
    console.error(`\n🚨 ADR-039 Check FAILED with ${violations.length} forbidden dependency/use violation(s)!`);
    process.exitCode = 1;
  } else {
    console.log('✅ ADR-039 Check PASSED: Zero unauthorized forbidden dependencies detected.');
    console.log('Local-only focus audio entries permitted; server upload dependencies remain forbidden. Not a runtime no-leak certification.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try { main(); } catch (_) {
    console.error('ADR-039 Check FAILED: policy/config/source inspection could not complete.');
    process.exitCode = 1;
  }
}
