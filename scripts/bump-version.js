#!/usr/bin/env node

/**
 * This script updates the version number across all relevant files.
 * Usage: node scripts/bump-version.js [major|minor|patch]
 */

const fs = require('fs');
const path = require('path');

// Get version bump type from command line args
const bumpType = process.argv[2] || 'patch';
if (!['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Invalid bump type. Use major, minor, or patch');
  process.exit(1);
}

// Read current version from manifest.json
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;

// Parse version parts
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Calculate new version based on bump type
let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
}

console.log(`Bumping version from ${currentVersion} to ${newVersion} (${bumpType})`);

// Update manifest.json
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✅ Updated ${manifestPath}`);

// Update package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ Updated ${packagePath}`);

console.log(`\n✨ Version successfully bumped to ${newVersion}`);
console.log(`\nCommit these changes with: git commit -am "Bump version to ${newVersion}"`);
