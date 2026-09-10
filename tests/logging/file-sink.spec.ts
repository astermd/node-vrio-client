import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSink } from '../../src/logging/file-sink.js';
import { VrioError } from '../../src/exception/vrio-error.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vrio-sink-'));
  FileSink.resetPruneState();
});

afterEach(() => {
  FileSink.resetPruneState();
});

describe('FileSink', () => {
  it('requires a base path', () => {
    expect(() => new FileSink('  ')).toThrow(VrioError);
    expect(() => new FileSink('  ')).toThrow(/debugFile/);
  });

  it('rejects an unrecognised timezone', () => {
    expect(() => new FileSink(join(dir, 'c.log'), 7, 'Not/AZone')).toThrow(VrioError);
    expect(() => new FileSink(join(dir, 'c.log'), 7, 'Not/AZone')).toThrow(/IANA/);
  });

  it('inserts the date before the extension', () => {
    const sink = new FileSink(join(dir, 'client.log'));
    const path = sink.pathForDate(new Date('2026-08-16T09:00:00Z'));
    expect(path).toBe(join(dir, 'client-2026-08-16.log'));
  });

  it('appends no extension when the base path has none', () => {
    const sink = new FileSink(join(dir, 'client'));
    expect(sink.pathForDate(new Date('2026-08-16T09:00:00Z'))).toBe(join(dir, 'client-2026-08-16'));
  });

  it('only splits off the last extension', () => {
    const sink = new FileSink(join(dir, 'client.debug.log'));
    expect(sink.pathForDate(new Date('2026-08-16T09:00:00Z'))).toBe(join(dir, 'client.debug-2026-08-16.log'));
  });

  it('preserves the extension case', () => {
    const sink = new FileSink(join(dir, 'x.LOG'));
    expect(sink.pathForDate(new Date('2026-08-16T09:00:00Z'))).toBe(join(dir, 'x-2026-08-16.LOG'));
  });

  it('writes an entry to today’s file', async () => {
    const sink = new FileSink(join(dir, 'client.log'));
    await sink.write('first\n');
    await sink.write('second\n');

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const contents = await readFile(join(dir, files[0]!), 'utf8');
    expect(contents).toBe('first\nsecond\n');
  });

  it('creates a missing directory', async () => {
    const sink = new FileSink(join(dir, 'nested', 'deeper', 'client.log'));
    await sink.write('entry\n');
    expect(await readdir(join(dir, 'nested', 'deeper'))).toHaveLength(1);
  });

  it('never rejects when the path cannot be written', async () => {
    // A path whose parent is an existing file cannot be created.
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    const sink = new FileSink(join(blocker, 'client.log'));
    await expect(sink.write('entry\n')).resolves.toBeUndefined();
  });

  it('prunes files older than the retention window', async () => {
    await writeFile(join(dir, 'client-2026-08-01.log'), 'old');
    await writeFile(join(dir, 'client-2026-08-15.log'), 'recent');

    const sink = new FileSink(join(dir, 'client.log'), 7);
    const deleted = await sink.prune(new Date('2026-08-16T00:00:00Z'));

    expect(deleted).toBe(1);
    expect(await readdir(dir)).toEqual(['client-2026-08-15.log']);
  });

  it('keeps everything when retention is zero', async () => {
    await writeFile(join(dir, 'client-2020-01-01.log'), 'ancient');
    const sink = new FileSink(join(dir, 'client.log'), 0);
    expect(await sink.prune(new Date('2026-08-16T00:00:00Z'))).toBe(0);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('never touches a file outside its own dated pattern', async () => {
    await writeFile(join(dir, 'unrelated.log'), 'keep');
    await writeFile(join(dir, 'other-2026-08-01.log'), 'keep');
    await writeFile(join(dir, 'client-2026-08-01.txt'), 'keep');
    await writeFile(join(dir, 'client-2026-08-01.log'), 'delete');

    const sink = new FileSink(join(dir, 'client.log'), 7);
    expect(await sink.prune(new Date('2026-08-16T00:00:00Z'))).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(['client-2026-08-01.txt', 'other-2026-08-01.log', 'unrelated.log']);
  });

  it('reads the age from the filename, not the mtime', async () => {
    const stale = join(dir, 'client-2026-08-01.log');
    await writeFile(stale, 'old');
    // Touch it so its mtime is now; a mtime-based prune would keep it.
    await writeFile(stale, 'old, appended');

    const sink = new FileSink(join(dir, 'client.log'), 7);
    expect(await sink.prune(new Date('2026-08-16T00:00:00Z'))).toBe(1);
  });

  it('prunes only once per process for a base path', async () => {
    await writeFile(join(dir, 'client-2026-08-01.log'), 'old');
    const sink = new FileSink(join(dir, 'client.log'), 7);

    await sink.write('entry\n');
    // Recreate the stale file; a second write must not prune again.
    await writeFile(join(dir, 'client-2026-08-01.log'), 'old again');
    await sink.write('entry\n');

    expect(await readdir(dir)).toContain('client-2026-08-01.log');
  });

  it('returns zero when the directory does not exist', async () => {
    const sink = new FileSink(join(dir, 'missing', 'client.log'), 7);
    expect(await sink.prune(new Date('2026-08-16T00:00:00Z'))).toBe(0);
  });

  it('names the file in the configured timezone', () => {
    const sink = new FileSink(join(dir, 'client.log'), 7, 'Asia/Kolkata');
    // 2026-08-16T20:00Z is 2026-08-17 in Asia/Kolkata (UTC+5:30).
    expect(sink.pathForDate(new Date('2026-08-16T20:00:00Z'))).toBe(join(dir, 'client-2026-08-17.log'));
  });

  it('exposes a bound sink function', async () => {
    const sink = new FileSink(join(dir, 'client.log'));
    const fn = sink.asSink();
    await fn('via bound fn\n');
    const files = await readdir(dir);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('via bound fn\n');
  });

  it('matches the measured retention arithmetic (retention=7)', async () => {
    const dates = [
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ];
    for (const date of dates) {
      await writeFile(join(dir, `client-${date}.log`), 'x');
    }
    await writeFile(join(dir, 'unrelated.log'), 'x');
    await writeFile(join(dir, 'other-2026-08-01.log'), 'x');
    await writeFile(join(dir, 'client-2026-08-01.txt'), 'x');

    const sink = new FileSink(join(dir, 'client.log'), 7);
    const deleted = await sink.prune(new Date('2026-08-16T00:00:00Z'));

    expect(deleted).toBe(4);
    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(
      [
        'client-2026-08-01.txt',
        'client-2026-08-09.log',
        'client-2026-08-10.log',
        'client-2026-08-11.log',
        'client-2026-08-12.log',
        'client-2026-08-13.log',
        'client-2026-08-14.log',
        'client-2026-08-15.log',
        'client-2026-08-16.log',
        'other-2026-08-01.log',
        'unrelated.log',
      ].sort(),
    );
  });

  it('matches the measured retention arithmetic (retention=1)', async () => {
    const dates = [
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ];
    for (const date of dates) {
      await writeFile(join(dir, `client-${date}.log`), 'x');
    }

    const sink = new FileSink(join(dir, 'client.log'), 1);
    const deleted = await sink.prune(new Date('2026-08-16T00:00:00Z'));

    expect(deleted).toBe(10);
    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(['client-2026-08-15.log', 'client-2026-08-16.log']);
  });
});
