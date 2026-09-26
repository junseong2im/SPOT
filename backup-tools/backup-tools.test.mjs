import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createBackup } from './create-backup.mjs';
import { restoreBackup } from './restore-backup.mjs';
import { CHUNK_BYTES, MAX_SOURCE_BYTES, sha256 } from './backup-common.mjs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceCommit = '1'.repeat(40);
const syntheticPrefix = 'gymworkout-backup-synthetic-';

async function exists(target) {
  try { await fs.lstat(target); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fixture(t, files = { 'alpha.txt': Buffer.from('synthetic alpha\n'), 'nested/한글.bin': Buffer.from([0, 1, 2, 253, 254, 255]), 'empty.txt': Buffer.alloc(0) }) {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, syntheticPrefix));
  t.after(async () => {
    // Recursive cleanup is confined to this test's own verified temporary root.
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), temporaryRoot.toLowerCase());
    assert.ok(path.basename(resolved).startsWith(syntheticPrefix));
    const stat = await fs.lstat(resolved);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    await fs.rm(resolved, { recursive: true, force: false });
  });
  const root = path.join(directory, 'source');
  const out = path.join(directory, 'archive');
  const keyFile = path.join(directory, 'synthetic-recovery-key.json');
  const pathsJson = path.join(directory, 'paths.json');
  const destination = path.join(directory, 'restored');
  await fs.mkdir(root);
  for (const [relative, bytes] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, bytes);
  }
  await fs.writeFile(pathsJson, JSON.stringify(Object.keys(files)));
  return { directory, root, out, keyFile, pathsJson, destination, sourceCommit, files };
}

async function manifestFor(f) {
  return JSON.parse(await fs.readFile(path.join(f.out, 'manifest.json'), 'utf8'));
}

async function rewriteAuthenticatedArchive(f, change) {
  // Adversarial archives are built only from this test's synthetic temporary data.
  const manifest = await manifestFor(f);
  const recovery = JSON.parse(await fs.readFile(f.keyFile, 'utf8'));
  const key = Buffer.from(recovery.key, 'base64');
  const nonce = Buffer.from(manifest.encryption.nonce, 'base64');
  const encrypted = Buffer.concat(await Promise.all(manifest.ciphertext.chunks.map((chunk) => fs.readFile(path.join(f.out, chunk.file)))));
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(Buffer.from(manifest.encryption.authTag, 'base64'));
  const archive = JSON.parse(gunzipSync(Buffer.concat([decipher.update(encrypted), decipher.final()])).toString('utf8'));
  change(archive);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(archive))), cipher.final()]);
  assert.ok(ciphertext.length < CHUNK_BYTES);
  const chunk = { file: 'encrypted-000001.bin', size: ciphertext.length, sha256: sha256(ciphertext) };
  await fs.writeFile(path.join(f.out, chunk.file), ciphertext);
  manifest.encryption.authTag = cipher.getAuthTag().toString('base64');
  manifest.ciphertext = { sha256: chunk.sha256, bytes: chunk.size, chunkSize: CHUNK_BYTES, chunks: [chunk] };
  await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify(manifest));
  key.fill(0);
}

test('CLI round trip, verify-only, comparison, and public manifest privacy', async (t) => {
  const f = await fixture(t);
  const created = await execute(process.execPath, [path.join(here, 'create-backup.mjs'), '--root', f.root, '--paths-json', f.pathsJson, '--out', f.out, '--key-file', f.keyFile, '--source-commit', sourceCommit]);
  const expected = { count: 3, bytes: 22, sourceCommit };
  assert.deepEqual(JSON.parse(created.stdout), expected);
  assert.equal(created.stderr, '');
  const verified = await execute(process.execPath, [path.join(here, 'restore-backup.mjs'), '--backup', f.out, '--key-file', f.keyFile, '--verify-only', '--compare-root', f.root]);
  assert.deepEqual(JSON.parse(verified.stdout), expected);
  assert.equal(await exists(f.destination), false);
  const restored = await restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination, compareRoot: f.root });
  assert.deepEqual(restored, expected);
  for (const [relative, bytes] of Object.entries(f.files)) assert.deepEqual(await fs.readFile(path.join(f.destination, relative)), bytes);
  const manifestText = await fs.readFile(path.join(f.out, 'manifest.json'), 'utf8');
  const recovery = JSON.parse(await fs.readFile(f.keyFile, 'utf8'));
  for (const relative of Object.keys(f.files)) assert.equal(manifestText.includes(relative), false);
  assert.equal(manifestText.includes(recovery.key), false);
  assert.equal(created.stdout.includes(recovery.key), false);
  assert.equal(Buffer.from(recovery.key, 'base64').length, 32);
  const manifest = JSON.parse(manifestText);
  assert.equal(Buffer.from(manifest.encryption.nonce, 'base64').length, 12);
  assert.equal(Buffer.from(manifest.encryption.authTag, 'base64').length, 16);
});

test('wrong key fails authentication and creates no destination', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const recovery = JSON.parse(await fs.readFile(f.keyFile, 'utf8'));
  recovery.key = randomBytes(32).toString('base64');
  await fs.writeFile(f.keyFile, JSON.stringify(recovery));
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }));
  assert.equal(await exists(f.destination), false);
});

test('tampered encrypted chunk is rejected before restore writes', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const manifest = await manifestFor(f);
  const chunkPath = path.join(f.out, manifest.ciphertext.chunks[0].file);
  const data = await fs.readFile(chunkPath);
  data[0] ^= 1;
  await fs.writeFile(chunkPath, data);
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /CHUNK_HASH_MISMATCH/);
  assert.equal(await exists(f.destination), false);
});

test('GCM detects tampering even when public ciphertext hashes are updated', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const manifest = await manifestFor(f);
  const chunk = manifest.ciphertext.chunks[0];
  const chunkPath = path.join(f.out, chunk.file);
  const data = await fs.readFile(chunkPath);
  data[data.length - 1] ^= 1;
  await fs.writeFile(chunkPath, data);
  chunk.sha256 = sha256(data);
  manifest.ciphertext.sha256 = chunk.sha256;
  await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }));
  assert.equal(await exists(f.destination), false);
});

test('source traversal, absolute paths, ADS, reserved names, and ambiguous Windows names are rejected', async (t) => {
  const f = await fixture(t);
  for (const invalid of ['../escape', '/absolute', 'C:\\absolute', 'alpha.txt:secret', 'CON.txt', 'nested/NUL', 'COM1', 'trailing.', 'trailing ', 'nested//file', './alpha.txt']) {
    await fs.writeFile(f.pathsJson, JSON.stringify([invalid]));
    await assert.rejects(createBackup(f), /UNSAFE_PATH/);
    assert.equal(await exists(f.keyFile), false);
  }
});

test('source duplicate paths are rejected including Windows case collisions', async (t) => {
  const f = await fixture(t);
  for (const names of [['alpha.txt', 'alpha.txt'], ['alpha.txt', 'ALPHA.TXT'], ['nested/a', 'nested\\a']]) {
    await fs.writeFile(f.pathsJson, JSON.stringify(names));
    await assert.rejects(createBackup(f), /DUPLICATE_PATH/);
  }
});

test('UTF-8 BOM in the input path list is accepted', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.pathsJson, `\uFEFF${JSON.stringify(Object.keys(f.files))}`);
  await createBackup(f);
  await restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true, compareRoot: f.root });
});

test('CLI directories option preserves empty directories and nested directory hierarchy', async (t) => {
  const f = await fixture(t);
  const directories = ['database', 'database/pg_stat', 'database/pg_commit_ts', 'nested/empty'];
  for (const relative of directories) await fs.mkdir(path.join(f.root, relative), { recursive: true });
  const directoriesJson = path.join(f.directory, 'directories.json');
  await fs.writeFile(directoriesJson, JSON.stringify(directories));
  await execute(process.execPath, [path.join(here, 'create-backup.mjs'), '--root', f.root, '--paths-json', f.pathsJson, '--directories-json', directoriesJson, '--out', f.out, '--key-file', f.keyFile, '--source-commit', sourceCommit]);
  const manifest = await manifestFor(f);
  assert.equal(manifest.directoryCount, directories.length);
  assert.equal(JSON.stringify(manifest).includes('pg_stat'), false);
  await restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true, compareRoot: f.root });
  await restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination });
  for (const relative of directories) assert.ok((await fs.lstat(path.join(f.destination, relative))).isDirectory());
  assert.deepEqual(await fs.readdir(path.join(f.destination, 'database/pg_stat')), []);
  assert.deepEqual(await fs.readdir(path.join(f.destination, 'nested/empty')), []);
});

test('directory case duplicates, unsafe paths, and file collisions are rejected', async (t) => {
  const f = await fixture(t);
  const directoriesJson = path.join(f.directory, 'directories.json');
  for (const [directories, message] of [
    [['nested', 'NESTED'], /DUPLICATE_DIRECTORY_PATH/],
    [['é', 'e\u0301'], /DUPLICATE_DIRECTORY_PATH/],
    [['../escape'], /UNSAFE_PATH/],
    [['ALPHA.TXT'], /FILE_DIRECTORY_COLLISION/],
    [['alpha.txt/empty'], /FILE_DIRECTORY_COLLISION/],
  ]) {
    await fs.writeFile(directoriesJson, JSON.stringify(directories));
    await assert.rejects(createBackup({ ...f, directoriesJson }), message);
    assert.equal(await exists(f.keyFile), false);
  }
});

test('authenticated archive traversal is rejected before destination creation', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  await rewriteAuthenticatedArchive(f, (archive) => { archive.entries[0].path = '../escape'; });
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /UNSAFE_PATH/);
  assert.equal(await exists(f.destination), false);
  assert.equal(await exists(path.join(f.directory, 'escape')), false);
});

test('authenticated archive case duplicates are rejected before destination creation', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  await rewriteAuthenticatedArchive(f, (archive) => { archive.entries[1].path = archive.entries[0].path.toUpperCase(); });
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /DUPLICATE_PATH/);
  assert.equal(await exists(f.destination), false);
});

test('nonempty destination is preserved', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  await fs.mkdir(f.destination);
  await fs.writeFile(path.join(f.destination, 'keep.txt'), 'keep');
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /DIRECTORY_NOT_EMPTY/);
  assert.equal(await fs.readFile(path.join(f.destination, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(f.destination), ['keep.txt']);
});

test('archive and key inside source, and key inside archive, are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createBackup({ ...f, out: path.join(f.root, 'archive') }), /OUTPUT_INSIDE_SOURCE_ROOT/);
  await assert.rejects(createBackup({ ...f, keyFile: path.join(f.root, 'key.json') }), /OUTPUT_INSIDE_SOURCE_ROOT/);
  await assert.rejects(createBackup({ ...f, keyFile: path.join(f.out, 'key.json') }), /KEY_INSIDE_ARCHIVE_DIRECTORY/);
  assert.equal(await exists(f.keyFile), false);
  assert.equal(await exists(f.out), false);
});

test('existing recovery key is never overwritten', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.keyFile, 'synthetic pre-existing key marker');
  await assert.rejects(createBackup(f), /KEY_FILE_ALREADY_EXISTS/);
  assert.equal(await fs.readFile(f.keyFile, 'utf8'), 'synthetic pre-existing key marker');
  assert.equal(await exists(f.out), false);
});

test('public source commit and summary manipulation are rejected', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const manifest = await manifestFor(f);
  for (const [field, value] of [['sourceCommit', '2'.repeat(40)], ['fileCount', 4], ['directoryCount', 1], ['totalBytes', 23]]) {
    await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify({ ...manifest, [field]: value }));
    await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true }), /MANIFEST_METADATA_MISMATCH/);
  }
});

test('archive entry hashes are checked after successful authentication', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  await rewriteAuthenticatedArchive(f, (archive) => { archive.entries[0].sha256 = '0'.repeat(64); });
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /ENTRY_HASH_MISMATCH/);
  assert.equal(await exists(f.destination), false);
});

test('compare-root detects changed source content', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  await fs.writeFile(path.join(f.root, 'alpha.txt'), 'changed synthetic bytes');
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true, compareRoot: f.root }), /COMPARE_ROOT_MISMATCH/);
});

test('source total beyond 300 MiB is rejected before key creation', async (t) => {
  const f = await fixture(t, { 'oversize.bin': Buffer.alloc(0) });
  const handle = await fs.open(path.join(f.root, 'oversize.bin'), 'r+');
  await handle.truncate(MAX_SOURCE_BYTES + 1);
  await handle.close();
  await assert.rejects(createBackup(f), /SOURCE_LIMIT_EXCEEDED/);
  assert.equal(await exists(f.keyFile), false);
});

test('ciphertext uses exact 20 MiB chunks except the last and restores correctly', async (t) => {
  const f = await fixture(t, { 'synthetic-random.bin': randomBytes(21 * 1024 * 1024) });
  await createBackup(f);
  const manifest = await manifestFor(f);
  assert.ok(manifest.ciphertext.chunks.length >= 2);
  assert.equal(manifest.ciphertext.chunks[0].size, CHUNK_BYTES);
  await restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination, compareRoot: f.root });
  assert.equal(sha256(await fs.readFile(path.join(f.destination, 'synthetic-random.bin'))), sha256(f.files['synthetic-random.bin']));
});

test('chunk traversal and cryptographic parameter lengths are rejected', async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const manifest = await manifestFor(f);
  const badChunk = structuredClone(manifest);
  badChunk.ciphertext.chunks[0].file = '../escape.bin';
  await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify(badChunk));
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true }), /UNSAFE_CHUNK_PATH/);
  for (const [field, size, message] of [['nonce', 11, /INVALID_NONCE/], ['authTag', 15, /INVALID_AUTH_TAG/]]) {
    const changed = structuredClone(manifest);
    changed.encryption[field] = Buffer.alloc(size).toString('base64');
    await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify(changed));
    await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true }), message);
  }
  await fs.writeFile(path.join(f.out, 'manifest.json'), JSON.stringify(manifest));
  const recovery = JSON.parse(await fs.readFile(f.keyFile, 'utf8'));
  recovery.key = Buffer.alloc(31).toString('base64');
  await fs.writeFile(f.keyFile, JSON.stringify(recovery));
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, verifyOnly: true }), /INVALID_RECOVERY_KEY/);
});

test('source and destination junction/symlink roots are rejected', async (t) => {
  const f = await fixture(t);
  const link = path.join(f.directory, 'linked-source');
  try { await fs.symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) {
    if (['EPERM', 'ENOSYS'].includes(error.code)) { t.skip('Symlink permission is unavailable'); return; }
    throw error;
  }
  await assert.rejects(createBackup({ ...f, root: link }), /SYMLINK_REJECTED/);
  await createBackup(f);
  const empty = path.join(f.directory, 'empty-destination');
  await fs.mkdir(empty);
  await fs.symlink(empty, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restoreBackup({ backup: f.out, keyFile: f.keyFile, destination: f.destination }), /SYMLINK_REJECTED/);
  assert.deepEqual(await fs.readdir(empty), []);
});
