import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const FORMAT = 'gymworkout-encrypted-local-backup';
export const VERSION = 1;
export const MAX_SOURCE_BYTES = 300 * 1024 * 1024;
export const MAX_JSON_BYTES = 512 * 1024 * 1024;
export const MAX_METADATA_BYTES = 16 * 1024 * 1024;
export const MAX_FILE_COUNT = 100_000;
export const CHUNK_BYTES = 20 * 1024 * 1024;
export const READ_BYTES = 192 * 1024;

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function requireThat(condition, code) {
  if (!condition) throw new BackupError(code);
}

export function reportError(operation, error) {
  // Never print native error messages: they may disclose source paths or content.
  const code = error instanceof BackupError ? error.code : 'IO_OR_FORMAT_ERROR';
  process.stderr.write(`${operation} failed: ${code}\n`);
  process.exitCode = 1;
}

export function parseArgs(argv, required, optional = [], flags = []) {
  const result = Object.create(null);
  const allowed = new Set([...required, ...optional, ...flags]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    requireThat(allowed.has(name) && !Object.hasOwn(result, name), 'INVALID_ARGUMENTS');
    if (flags.includes(name)) result[name] = true;
    else {
      const value = argv[++index];
      requireThat(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'INVALID_ARGUMENTS');
      result[name] = value;
    }
  }
  for (const name of required) requireThat(Object.hasOwn(result, name), 'MISSING_ARGUMENT');
  return result;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isSourceCommit(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function exactKeys(value, keys, code = 'INVALID_FORMAT') {
  requireThat(isPlainObject(value), code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  requireThat(actual.length === expected.length && actual.every((item, index) => item === expected[index]), code);
}

export function safeRelativePath(value) {
  requireThat(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 32_768, 'UNSAFE_PATH');
  requireThat(Buffer.from(value, 'utf8').toString('utf8') === value, 'UNSAFE_PATH');
  requireThat(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), 'UNSAFE_PATH');
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  for (const segment of segments) {
    requireThat(segment !== '' && segment !== '.' && segment !== '..', 'UNSAFE_PATH');
    requireThat(!/[<>:"|?*\x00-\x1f\x7f]/u.test(segment) && !/[. ]$/u.test(segment), 'UNSAFE_PATH');
    requireThat(!/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu.test(segment), 'UNSAFE_PATH');
  }
  return normalized;
}

export function uniquePaths(values) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= MAX_FILE_COUNT, 'INVALID_PATH_LIST');
  const normalized = values.map(safeRelativePath);
  const keys = normalized.map((value) => value.normalize('NFC').toLowerCase());
  const all = new Set(keys);
  requireThat(all.size === keys.length, 'DUPLICATE_PATH');
  for (const key of keys) {
    const parts = key.split('/');
    for (let count = 1; count < parts.length; count += 1) {
      requireThat(!all.has(parts.slice(0, count).join('/')), 'FILE_DIRECTORY_COLLISION');
    }
  }
  return normalized;
}

export function uniqueDirectoryPaths(values, files) {
  requireThat(Array.isArray(values) && values.length <= MAX_FILE_COUNT, 'INVALID_DIRECTORY_LIST');
  const normalized = values.map(safeRelativePath);
  const keys = normalized.map((value) => value.normalize('NFC').toLowerCase());
  requireThat(new Set(keys).size === keys.length, 'DUPLICATE_DIRECTORY_PATH');
  const fileKeys = new Set(files.map((value) => value.normalize('NFC').toLowerCase()));
  for (const key of keys) {
    const parts = key.split('/');
    for (let count = 1; count <= parts.length; count += 1) {
      requireThat(!fileKeys.has(parts.slice(0, count).join('/')), 'FILE_DIRECTORY_COLLISION');
    }
  }
  return normalized;
}

function comparisonPath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isInside(root, candidate) {
  const relative = path.relative(comparisonPath(root), comparisonPath(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function inspectPathTree(target, leafType, allowMissing = false) {
  const absolute = path.resolve(target);
  const { root } = path.parse(absolute);
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  const rootStat = await fs.lstat(root, { bigint: true });
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'UNSAFE_FILESYSTEM_PATH');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw error;
    }
    requireThat(!stat.isSymbolicLink(), 'SYMLINK_REJECTED');
    const expected = index === segments.length - 1 ? leafType : 'directory';
    if (expected === 'directory') requireThat(stat.isDirectory(), 'NOT_A_DIRECTORY');
    if (expected === 'file') requireThat(stat.isFile(), 'NOT_A_REGULAR_FILE');
  }
  return fs.lstat(absolute, { bigint: true });
}

export async function safeDirectory(value) {
  const absolute = path.resolve(value);
  await inspectPathTree(absolute, 'directory');
  const actual = await fs.realpath(absolute);
  requireThat(comparisonPath(actual) === comparisonPath(absolute), 'UNSAFE_FILESYSTEM_PATH');
  return actual;
}

export async function prepareEmptyDirectory(value) {
  const absolute = path.resolve(value);
  await inspectPathTree(absolute, 'directory', true);
  await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
  const actual = await safeDirectory(absolute);
  requireThat((await fs.readdir(actual)).length === 0, 'DIRECTORY_NOT_EMPTY');
  return actual;
}

function fingerprint(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export async function directoryFingerprints(root, directories) {
  await safeDirectory(root);
  const results = [];
  for (const relative of directories) {
    const normalized = safeRelativePath(relative);
    const absolute = path.resolve(root, ...normalized.split('/'));
    requireThat(isInside(root, absolute), 'UNSAFE_PATH');
    await safeDirectory(absolute);
    results.push(fingerprint(await inspectPathTree(absolute, 'directory')));
  }
  return results;
}

export async function safeFileStat(root, relative) {
  const normalized = safeRelativePath(relative);
  const absolute = path.resolve(root, ...normalized.split('/'));
  requireThat(isInside(root, absolute) && comparisonPath(root) !== comparisonPath(absolute), 'UNSAFE_PATH');
  await safeDirectory(root);
  const stat = await inspectPathTree(absolute, 'file');
  const actual = await fs.realpath(absolute);
  requireThat(isInside(root, actual) && comparisonPath(actual) === comparisonPath(absolute), 'UNSAFE_FILESYSTEM_PATH');
  return { absolute, stat, fingerprint: fingerprint(stat) };
}

export async function* stableFileChunks(root, relative, expected = null) {
  const before = await safeFileStat(root, relative);
  if (expected) requireThat(before.fingerprint === expected.fingerprint, 'SOURCE_CHANGED');
  const handle = await fs.open(before.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash('sha256');
  let size = 0;
  try {
    const opened = await handle.stat({ bigint: true });
    requireThat(opened.isFile() && fingerprint(opened) === before.fingerprint, 'SOURCE_CHANGED');
    while (true) {
      const buffer = Buffer.allocUnsafe(READ_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      requireThat(size <= MAX_SOURCE_BYTES && BigInt(size) <= before.stat.size, 'SOURCE_CHANGED_OR_TOO_LARGE');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      yield chunk;
    }
    const after = await handle.stat({ bigint: true });
    requireThat(fingerprint(after) === before.fingerprint && BigInt(size) === before.stat.size, 'SOURCE_CHANGED');
    const finalPath = await safeFileStat(root, relative);
    requireThat(finalPath.fingerprint === before.fingerprint, 'SOURCE_CHANGED');
    if (expected) requireThat(hash.digest('hex') === expected.sha256 && size === expected.size, 'SOURCE_CHANGED');
  } finally {
    await handle.close();
  }
}

export async function hashStableFile(root, relative, expected = null) {
  const before = await safeFileStat(root, relative);
  requireThat(before.stat.size <= BigInt(MAX_SOURCE_BYTES), 'SOURCE_LIMIT_EXCEEDED');
  const hash = createHash('sha256');
  let size = 0;
  for await (const buffer of stableFileChunks(root, relative, expected)) {
    hash.update(buffer);
    size += buffer.length;
  }
  const after = await safeFileStat(root, relative);
  requireThat(before.fingerprint === after.fingerprint, 'SOURCE_CHANGED');
  return { path: safeRelativePath(relative), size, sha256: hash.digest('hex'), fingerprint: before.fingerprint };
}

export async function readSmallJsonFile(absolute, maximum = MAX_METADATA_BYTES) {
  const resolved = path.resolve(absolute);
  const before = await inspectPathTree(resolved, 'file');
  requireThat(before.size <= BigInt(maximum), 'METADATA_LIMIT_EXCEEDED');
  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    requireThat(fingerprint(opened) === fingerprint(before), 'SOURCE_CHANGED');
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      requireThat(bytesRead > 0, 'SOURCE_CHANGED');
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    requireThat((await handle.read(extra, 0, 1, null)).bytesRead === 0, 'SOURCE_CHANGED');
    const after = await handle.stat({ bigint: true });
    const finalPath = await inspectPathTree(resolved, 'file');
    requireThat(fingerprint(before) === fingerprint(after) && fingerprint(before) === fingerprint(finalPath), 'SOURCE_CHANGED');
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/u, ''));
  } finally {
    await handle.close();
  }
}

export function decodeBase64(value, expectedBytes, code) {
  requireThat(typeof value === 'string' && Number.isSafeInteger(expectedBytes) && expectedBytes >= 0, code);
  requireThat(value.length === 4 * Math.ceil(expectedBytes / 3), code);
  requireThat(!/[^A-Za-z0-9+/=]/u.test(value), code);
  const padding = value.indexOf('=');
  requireThat(padding === -1 || (padding >= value.length - 2 && /^={1,2}$/u.test(value.slice(padding))), code);
  if (value.length > 0) {
    const tail = value.slice(-4);
    requireThat(Buffer.from(tail, 'base64').toString('base64') === tail, code);
  }
  const decoded = Buffer.from(value, 'base64');
  requireThat(decoded.length === expectedBytes, code);
  return decoded;
}

export async function writeNewFile(absolute, data, mode = 0o600) {
  const resolved = path.resolve(absolute);
  await safeDirectory(path.dirname(resolved));
  const handle = await fs.open(resolved, 'wx', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
