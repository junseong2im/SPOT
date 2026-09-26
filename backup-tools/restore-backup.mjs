import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import {
  FORMAT, VERSION, MAX_SOURCE_BYTES, MAX_JSON_BYTES, MAX_FILE_COUNT, CHUNK_BYTES,
  requireThat, parseArgs, reportError, sha256, isHash, isSourceCommit, exactKeys,
  uniquePaths, uniqueDirectoryPaths, safeDirectory, inspectPathTree, prepareEmptyDirectory, stableFileChunks,
  hashStableFile, readSmallJsonFile, decodeBase64, writeNewFile, directoryFingerprints,
} from './backup-common.mjs';

function validateManifest(manifest) {
  exactKeys(manifest, ['format', 'version', 'sourceCommit', 'fileCount', 'directoryCount', 'totalBytes', 'compression', 'encryption', 'ciphertext']);
  requireThat(manifest.format === FORMAT && manifest.version === VERSION && manifest.compression === 'gzip', 'INVALID_FORMAT');
  requireThat(isSourceCommit(manifest.sourceCommit), 'INVALID_SOURCE_COMMIT');
  requireThat(Number.isSafeInteger(manifest.fileCount) && manifest.fileCount > 0 && manifest.fileCount <= MAX_FILE_COUNT, 'INVALID_FILE_COUNT');
  requireThat(Number.isSafeInteger(manifest.directoryCount) && manifest.directoryCount >= 0 && manifest.directoryCount <= MAX_FILE_COUNT, 'INVALID_DIRECTORY_COUNT');
  requireThat(Number.isSafeInteger(manifest.totalBytes) && manifest.totalBytes >= 0 && manifest.totalBytes <= MAX_SOURCE_BYTES, 'SOURCE_LIMIT_EXCEEDED');
  exactKeys(manifest.encryption, ['algorithm', 'nonce', 'authTag']);
  requireThat(manifest.encryption.algorithm === 'aes-256-gcm', 'INVALID_ENCRYPTION');
  const nonce = decodeBase64(manifest.encryption.nonce, 12, 'INVALID_NONCE');
  const authTag = decodeBase64(manifest.encryption.authTag, 16, 'INVALID_AUTH_TAG');
  exactKeys(manifest.ciphertext, ['sha256', 'bytes', 'chunkSize', 'chunks']);
  const ciphertext = manifest.ciphertext;
  requireThat(isHash(ciphertext.sha256) && ciphertext.chunkSize === CHUNK_BYTES, 'INVALID_CIPHERTEXT');
  requireThat(Number.isSafeInteger(ciphertext.bytes) && ciphertext.bytes > 0 && ciphertext.bytes <= MAX_JSON_BYTES + 1024 * 1024, 'INVALID_CIPHERTEXT');
  requireThat(Array.isArray(ciphertext.chunks) && ciphertext.chunks.length === Math.ceil(ciphertext.bytes / CHUNK_BYTES), 'INVALID_CHUNKS');
  let total = 0;
  for (let index = 0; index < ciphertext.chunks.length; index += 1) {
    const chunk = ciphertext.chunks[index];
    exactKeys(chunk, ['file', 'size', 'sha256']);
    requireThat(chunk.file === `encrypted-${String(index + 1).padStart(6, '0')}.bin`, 'UNSAFE_CHUNK_PATH');
    requireThat(Number.isSafeInteger(chunk.size) && chunk.size > 0 && chunk.size <= CHUNK_BYTES && isHash(chunk.sha256), 'INVALID_CHUNKS');
    if (index < ciphertext.chunks.length - 1) requireThat(chunk.size === CHUNK_BYTES, 'INVALID_CHUNKS');
    total += chunk.size;
  }
  requireThat(total === ciphertext.bytes, 'INVALID_CHUNKS');
  return { nonce, authTag };
}

function validateArchive(archive, manifest) {
  exactKeys(archive, ['format', 'version', 'sourceCommit', 'fileCount', 'directoryCount', 'totalBytes', 'directories', 'entries']);
  for (const field of ['format', 'version', 'sourceCommit', 'fileCount', 'directoryCount', 'totalBytes']) {
    requireThat(archive[field] === manifest[field], 'MANIFEST_METADATA_MISMATCH');
  }
  requireThat(Array.isArray(archive.entries) && archive.entries.length === manifest.fileCount, 'INVALID_FILE_COUNT');
  const paths = uniquePaths(archive.entries.map((entry) => {
    exactKeys(entry, ['path', 'sha256', 'size', 'data']);
    return entry.path;
  }));
  requireThat(Array.isArray(archive.directories) && archive.directories.length === manifest.directoryCount, 'INVALID_DIRECTORY_COUNT');
  const directories = uniqueDirectoryPaths(archive.directories, paths);
  requireThat(directories.every((value, index) => value === archive.directories[index]), 'NONCANONICAL_ARCHIVE_PATH');
  let totalBytes = 0;
  for (let index = 0; index < archive.entries.length; index += 1) {
    const entry = archive.entries[index];
    requireThat(entry.path === paths[index], 'NONCANONICAL_ARCHIVE_PATH');
    requireThat(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_SOURCE_BYTES && isHash(entry.sha256), 'INVALID_ENTRY');
    totalBytes += entry.size;
    requireThat(totalBytes <= MAX_SOURCE_BYTES, 'SOURCE_LIMIT_EXCEEDED');
    const decoded = decodeBase64(entry.data, entry.size, 'INVALID_ENTRY_DATA');
    requireThat(sha256(decoded) === entry.sha256, 'ENTRY_HASH_MISMATCH');
  }
  requireThat(totalBytes === manifest.totalBytes, 'INVALID_TOTAL_BYTES');
}

async function decodeArchive(backup, manifest, key, nonce, authTag) {
  // Verify every public chunk and the full ciphertext before attempting decryption.
  const verified = [];
  const ciphertextHash = createHash('sha256');
  for (const chunk of manifest.ciphertext.chunks) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const data of stableFileChunks(backup, chunk.file)) {
      hash.update(data);
      ciphertextHash.update(data);
      size += data.length;
      requireThat(size <= chunk.size, 'CHUNK_SIZE_MISMATCH');
    }
    requireThat(size === chunk.size && hash.digest('hex') === chunk.sha256, 'CHUNK_HASH_MISMATCH');
    verified.push(await hashStableFile(backup, chunk.file));
  }
  requireThat(ciphertextHash.digest('hex') === manifest.ciphertext.sha256, 'CIPHERTEXT_HASH_MISMATCH');
  async function* encryptedBytes() {
    for (const chunk of verified) yield* stableFileChunks(backup, chunk.path, chunk);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  let length = 0;
  let buffers = [];
  const collector = new Writable({
    write(buffer, encoding, callback) {
      length += buffer.length;
      if (length > MAX_JSON_BYTES) {
        callback(new Error('Archive size limit exceeded'));
        return;
      }
      buffers.push(buffer);
      callback();
    },
  });
  await pipeline(Readable.from(encryptedBytes()), decipher, createGunzip(), collector);
  let serialized = Buffer.concat(buffers, length);
  buffers = [];
  const archive = JSON.parse(serialized.toString('utf8'));
  serialized = null;
  return archive;
}

export async function restoreBackup(options) {
  requireThat(options.verifyOnly || typeof options.destination === 'string', 'DESTINATION_REQUIRED');
  requireThat(!options.verifyOnly || options.destination === undefined, 'VERIFY_ONLY_WITH_DESTINATION');
  const backup = await safeDirectory(options.backup);
  const manifest = await readSmallJsonFile(path.join(backup, 'manifest.json'));
  const { nonce, authTag } = validateManifest(manifest);
  const recovery = await readSmallJsonFile(options.keyFile, 4096);
  exactKeys(recovery, ['format', 'version', 'key'], 'INVALID_RECOVERY_KEY');
  requireThat(recovery.format === `${FORMAT}-recovery-key` && recovery.version === VERSION, 'INVALID_RECOVERY_KEY');
  const key = decodeBase64(recovery.key, 32, 'INVALID_RECOVERY_KEY');
  let archive;
  try {
    archive = await decodeArchive(backup, manifest, key, nonce, authTag);
  } finally {
    key.fill(0);
    recovery.key = '';
  }
  validateArchive(archive, manifest);
  if (options.compareRoot !== undefined) {
    const compareRoot = await safeDirectory(options.compareRoot);
    await directoryFingerprints(compareRoot, archive.directories);
    for (const entry of archive.entries) {
      const source = await hashStableFile(compareRoot, entry.path);
      requireThat(source.size === entry.size && source.sha256 === entry.sha256, 'COMPARE_ROOT_MISMATCH');
    }
  }
  if (!options.verifyOnly) {
    // No destination is created until authentication and every entry check pass.
    const destination = await prepareEmptyDirectory(options.destination);
    for (const relative of archive.directories) {
      await safeDirectory(destination);
      const absolute = path.join(destination, ...relative.split('/'));
      await inspectPathTree(absolute, 'directory', true);
      await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
      await safeDirectory(absolute);
    }
    for (const entry of archive.entries) {
      await safeDirectory(destination);
      const absolute = path.join(destination, ...entry.path.split('/'));
      await inspectPathTree(path.dirname(absolute), 'directory', true);
      await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
      await safeDirectory(path.dirname(absolute));
      await writeNewFile(absolute, decodeBase64(entry.data, entry.size, 'INVALID_ENTRY_DATA'));
    }
    // Check the final restored files, including a concurrent rewrite or link swap.
    for (const entry of archive.entries) {
      const restored = await hashStableFile(destination, entry.path);
      requireThat(restored.size === entry.size && restored.sha256 === entry.sha256, 'RESTORED_FILE_MISMATCH');
    }
    await directoryFingerprints(destination, archive.directories);
  }
  return { count: manifest.fileCount, bytes: manifest.totalBytes, sourceCommit: manifest.sourceCommit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['--backup', '--key-file'], ['--destination', '--compare-root'], ['--verify-only']);
  const summary = await restoreBackup({ backup: args['--backup'], keyFile: args['--key-file'], destination: args['--destination'], compareRoot: args['--compare-root'], verifyOnly: args['--verify-only'] === true });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => reportError('Restore', error));
}
