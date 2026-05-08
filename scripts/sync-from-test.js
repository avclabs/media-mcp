#!/usr/bin/env node
/**
 * 同步脚本：从测试服同步代码到生产服
 * 只同步业务代码和依赖，保留生产服配置不变
 *
 * 用法：node scripts/sync-from-test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径配置
const TEST_DIR = 'E:/mcp_test/http_mcp_client/js_client';
const PROD_DIR = path.resolve(__dirname, '..');

// 需要直接复制的文件（相对于项目根目录）
const FILES_TO_COPY = [
  'tsconfig.json',
  'LICENSE',
  'README.md',
  'README_EN.md',
  '.gitignore',
  '.npmignore',
];

// 需要同步的目录
const DIRS_TO_COPY = [
  'src',
];

// package.json 中需要从测试服同步的字段
const PACKAGE_SYNC_FIELDS = [
  'type',
  'description',
  'main',
  'types',
  'files',
  'scripts',
  'keywords',
  'author',
  'license',
  'dependencies',
  'devDependencies',
  'engines',
];

// package.json 中保留生产服值的字段（这些字段不会被测试服覆盖）
const PACKAGE_PROTECTED_FIELDS = [
  'name',
  'version',
  'mcpName',
  'bin',
  'repository',
  'bugs',
  'homepage',
  'mcpServer',
];

function log(message) {
  console.log(`[sync] ${message}`);
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  log(`Copied: ${path.relative(PROD_DIR, dest)}`);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function syncPackageJson() {
  const testPkgPath = path.join(TEST_DIR, 'package.json');
  const prodPkgPath = path.join(PROD_DIR, 'package.json');

  const testPkg = JSON.parse(fs.readFileSync(testPkgPath, 'utf-8'));
  const prodPkg = JSON.parse(fs.readFileSync(prodPkgPath, 'utf-8'));

  // 创建新的 package.json，以生产服为基础
  const mergedPkg = { ...prodPkg };

  // 从测试服同步指定字段
  for (const field of PACKAGE_SYNC_FIELDS) {
    if (field in testPkg) {
      mergedPkg[field] = testPkg[field];
    }
  }

  // 确保受保护字段仍然是生产服的值
  for (const field of PACKAGE_PROTECTED_FIELDS) {
    if (field in prodPkg) {
      mergedPkg[field] = prodPkg[field];
    }
  }

  fs.writeFileSync(prodPkgPath, JSON.stringify(mergedPkg, null, 2) + '\n');
  log(`Merged: package.json (protected: ${PACKAGE_PROTECTED_FIELDS.join(', ')})`);
}

function runInProd(command) {
  log(`Running: ${command}`);
  execSync(command, { cwd: PROD_DIR, stdio: 'inherit' });
}

// ========== 主流程 ==========

async function main() {
  log('Starting sync from test to production...');
  log(`Test dir:  ${TEST_DIR}`);
  log(`Prod dir:  ${PROD_DIR}`);

  // 检查测试服目录是否存在
  if (!fs.existsSync(TEST_DIR)) {
    console.error(`Error: Test directory does not exist: ${TEST_DIR}`);
    process.exit(1);
  }

  // 1. 复制文件
  for (const file of FILES_TO_COPY) {
    const src = path.join(TEST_DIR, file);
    const dest = path.join(PROD_DIR, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      log(`Skipped (not found in test): ${file}`);
    }
  }

  // 2. 复制目录
  for (const dir of DIRS_TO_COPY) {
    const src = path.join(TEST_DIR, dir);
    const dest = path.join(PROD_DIR, dir);
    if (fs.existsSync(src)) {
      copyDir(src, dest);
    } else {
      log(`Skipped (not found in test): ${dir}`);
    }
  }

  // 3. 智能合并 package.json
  syncPackageJson();

  // 4. 重新安装依赖并构建
  runInProd('npm install');
  runInProd('npm run build');

  log('Sync complete!');
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
