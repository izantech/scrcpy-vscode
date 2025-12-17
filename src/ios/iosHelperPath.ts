import * as fs from 'fs';
import * as path from 'path';

function isFilePath(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function ensureExecutable(candidatePath: string): boolean {
  if (candidatePath.endsWith('.js')) {
    return true;
  }

  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    // Attempt to fix missing executable bit (common when copying into dist/vsix).
    try {
      fs.chmodSync(candidatePath, 0o755);
      fs.accessSync(candidatePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Resolve the path to the bundled `ios-helper` binary.
 *
 * The location differs between:
 * - Development (Swift build output under `native/ios-helper/.build/...`)
 * - Packaged extension (copied by webpack into `dist/ios-helper/ios-helper`)
 */
export function resolveIOSHelperPath(customHelperPath?: string): string {
  if (customHelperPath) {
    if (fs.existsSync(customHelperPath) && isFilePath(customHelperPath)) {
      ensureExecutable(customHelperPath);
    }
    return customHelperPath;
  }

  const envHelperPath = process.env.IOS_HELPER_PATH;
  if (envHelperPath && fs.existsSync(envHelperPath) && isFilePath(envHelperPath)) {
    ensureExecutable(envHelperPath);
    return envHelperPath;
  }

  const candidateRoots = [
    path.resolve(__dirname, '..'), // dist -> extension root; src/ios -> src
    path.resolve(__dirname, '..', '..'), // src/ios -> extension root
  ];

  let extensionRoot = candidateRoots[0];
  for (const root of candidateRoots) {
    if (fs.existsSync(path.join(root, 'package.json'))) {
      extensionRoot = root;
      break;
    }
  }

  const candidates = [
    // Packaged (webpack copy plugin currently creates dist/ios-helper/ios-helper)
    path.join(extensionRoot, 'dist', 'ios-helper', 'ios-helper'),
    // Packaged (if the binary is copied as a direct file)
    path.join(extensionRoot, 'dist', 'ios-helper'),
    // Legacy/alternate packaging
    path.join(extensionRoot, 'ios-helper'),
    // Development build outputs (SwiftPM)
    path.join(
      extensionRoot,
      'native',
      'ios-helper',
      '.build',
      'arm64-apple-macosx',
      'release',
      'ios-helper'
    ),
    path.join(
      extensionRoot,
      'native',
      'ios-helper',
      '.build',
      'x86_64-apple-macosx',
      'release',
      'ios-helper'
    ),
    path.join(extensionRoot, 'native', 'ios-helper', '.build', 'release', 'ios-helper'),
  ];

  let firstExistingFile: string | null = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    if (!isFilePath(candidate)) {
      continue;
    }

    firstExistingFile ??= candidate;
    if (ensureExecutable(candidate)) {
      return candidate;
    }
  }

  // Return the most likely path so error messages remain actionable.
  return firstExistingFile ?? candidates[0];
}
