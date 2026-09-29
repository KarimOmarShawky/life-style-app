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

// Read allowlist
const allowlistPath = path.join(__dirname, 'forbidden-allowlist.json');
let allowlistedNames = [];
if (fs.existsSync(allowlistPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    allowlistedNames = (raw.allowlist || []).map((item) => item.dependency.toLowerCase());
  } catch (err) {
    console.warn('⚠️ Warning: Could not parse forbidden-allowlist.json:', err.message);
  }
}

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
    category: 'File Storage / Multipart Parsing (ADR-008, D-08)',
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
  'mobile/pubspec.yaml',
  'mobile/pubspec.lock',
  'docker/docker-compose.yml',
  'docker/Dockerfile',
  'docker-compose.yml',
  '.env.example',
  'backend/.env.example'
];

let violationsFound = 0;

console.log('🔍 Running ADR-039 Forbidden-Dependency Guard...');

// Check production dependencies specifically in backend/package.json
const backendPkgPath = path.join(rootDir, 'backend/package.json');
if (fs.existsSync(backendPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
  const prodDeps = Object.keys(pkg.dependencies || {});
  for (const dep of prodDeps) {
    for (const rule of FORBIDDEN_RULES) {
      for (const token of rule.tokens) {
        if (dep.toLowerCase() === token.toLowerCase()) {
          console.error(`❌ [DIRECT VIOLATION] ${rule.category} in backend/package.json dependencies: ${dep}`);
          violationsFound++;
        }
      }
    }
  }
}

for (const relPath of FILES_TO_SCAN) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, lineIndex) => {
    for (const rule of FORBIDDEN_RULES) {
      for (let i = 0; i < rule.patterns.length; i++) {
        const pattern = rule.patterns[i];
        const token = rule.tokens[i];

        if (pattern.test(line)) {
          // Check if token is allowlisted
          if (token && allowlistedNames.includes(token.toLowerCase())) {
            // Permitted false positive from allowlist
            continue;
          }

          console.error(
            `❌ [VIOLATION] ${rule.category} detected in ${relPath}:${lineIndex + 1}`
          );
          console.error(`   Content: "${line.trim()}"`);
          violationsFound++;
        }
      }
    }
  });
}

if (violationsFound > 0) {
  console.error(
    `\n🚨 ADR-039 Check FAILED with ${violationsFound} forbidden dependency violation(s)!`
  );
  console.error(
    'Out-of-scope technologies (MongoDB, cookies/CSRF, file uploads, AI, offline sync) are strictly forbidden in MVP R1.'
  );
  process.exit(1);
} else {
  console.log('✅ ADR-039 Check PASSED: Zero unauthorized forbidden dependencies detected.\n');
  process.exit(0);
}
