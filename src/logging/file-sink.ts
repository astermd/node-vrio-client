import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { Config } from '../config.js';
import { VrioError } from '../exception/vrio-error.js';

/**
 * Validate an IANA timezone identifier by attempting to build a formatter
 * with it. `Intl.DateTimeFormat` throws `RangeError` for a `timeZone` it
 * does not recognise, which is the closest analogue to PHP's `DateTimeZone`
 * constructor throwing on an unknown identifier.
 *
 * @throws VrioError When `timezone` is not a recognised IANA identifier.
 */
export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new VrioError(Config.get('Messages.invalidTimezone'));
  }
}

/**
 * Render a `Date` as `YYYY-MM-DD` in the given IANA zone.
 *
 * `en-CA` is used because its short date format is already ISO-ordered
 * (`YYYY-MM-DD`), which avoids reassembling the year/month/day parts by
 * hand.
 *
 * Exported so {@link FileSink} and the debug logger's timestamp formatting
 * (Task 8) can share one implementation.
 */
export function formatDateInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Base paths already pruned in this process, keyed by base path.
 *
 * Module-level (rather than a static class field) so it truly lives once per
 * process regardless of how many `FileSink` instances point at the same
 * base path — matching the PHP's `private static $pruned` semantics without
 * relying on a type-level modifier that erases at runtime.
 */
const pruned = new Set<string>();

/**
 * Escape a string for safe interpolation into a `RegExp` source.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Built-in log destination: one file per calendar day, with retention.
 *
 * A base path of `"/var/log/vrio.log"` produces `"/var/log/vrio-2026-08-16.log"`,
 * `"/var/log/vrio-2026-08-17.log"`, and so on.
 *
 * Pruning only ever considers files matching this sink's own dated pattern
 * (`"<stem>-YYYY-MM-DD<.ext>"`) for the given base path, and reads the date
 * from the **filename** rather than from the filesystem modification time.
 * Appending to a file (as `write` does every time it is used) updates its
 * mtime, so an mtime-based prune would keep a month-old file alive
 * indefinitely simply because it was recently written to; reading the date
 * out of the name instead gives the file its true, stable age. Pruning also
 * runs at most once per process — not once per call to `write` — so a
 * long-lived process does not repeatedly re-scan its log directory.
 *
 * Supply a sink function instead of a base path (see `DebugSink` in
 * `client-config.ts`) to replace this class entirely; the package then
 * writes no files at all and retention becomes the caller's concern.
 */
export class FileSink {
  /**
   * Days of history kept when the caller does not say otherwise.
   */
  public static readonly DEFAULT_RETENTION_DAYS = 7;

  readonly #basePath: string;
  readonly #retentionDays: number;
  readonly #timezone: string;

  /**
   * @param basePath Caller-supplied path; the date is inserted before the
   *   last extension (see {@link FileSink.pathForDate}).
   * @param retentionDays Days of history to keep. Clamped to a minimum of 0;
   *   0 keeps everything.
   * @param timezone IANA timezone used for both the filename date and the
   *   retention cutoff.
   * @throws VrioError When `basePath` is empty (or whitespace-only) or
   *   `timezone` is not a recognised IANA identifier.
   */
  public constructor(basePath: string, retentionDays: number = FileSink.DEFAULT_RETENTION_DAYS, timezone = 'UTC') {
    if (basePath.trim() === '') {
      throw new VrioError(Config.get('Messages.debugFileRequired'));
    }
    assertTimezone(timezone);

    this.#basePath = basePath;
    this.#retentionDays = Math.max(0, Math.trunc(retentionDays));
    this.#timezone = timezone;
    Object.freeze(this);
  }

  /**
   * Append one entry to the current day's file, pruning old files on first
   * use.
   *
   * Never rejects: a logging failure must not break the API call that
   * triggered it. A missing directory is created; any other failure
   * (an unwritable path, a directory that cannot be created, and so on) is
   * silently swallowed.
   */
  public async write(entry: string): Promise<void> {
    try {
      const now = new Date();
      const path = this.pathForDate(now);

      await mkdir(dirname(path), { recursive: true, mode: 0o775 });
      await appendFile(path, entry, 'utf8');

      await this.pruneOnce(now);
    } catch {
      // Intentionally swallowed: logging must never break the caller.
    }
  }

  /**
   * A bound `write`, so a `FileSink` instance can be passed anywhere a
   * `DebugSink` function is expected (there is no JS equivalent of PHP's
   * `__invoke`).
   */
  public asSink(): (entry: string) => Promise<void> {
    return (entry: string) => this.write(entry);
  }

  /**
   * Resolve the dated filename for a given instant.
   *
   * Deliberate divergence from the PHP: PHP's `pathForDate` formats using
   * the *passed* `DateTimeImmutable`'s own timezone and ignores the sink's
   * configured zone entirely — the sink's zone only takes effect inside
   * `__invoke`, which builds `new DateTimeImmutable('now', $this->timezone)`
   * before calling `pathForDate`. A JavaScript `Date` is a bare instant with
   * no attached timezone (unlike `DateTimeImmutable`, which carries one), so
   * there is no "date's own zone" for this port to read — formatting here
   * must use the sink's configured zone instead. This makes `write()`'s
   * observable behaviour identical between the two packages (both name the
   * file by the current date in the configured zone); only a direct call to
   * the public `pathForDate` with an off-zone date could tell them apart,
   * and that call has no expressible equivalent in JavaScript.
   */
  public pathForDate(date: Date): string {
    const day = formatDateInZone(date, this.#timezone);

    return join(this.directory(), `${this.stem()}-${day}${this.extensionSuffix()}`);
  }

  /**
   * Delete dated files older than the retention window.
   *
   * Only files matching this sink's own `"<stem>-YYYY-MM-DD<.ext>"` pattern
   * in the base path's directory are considered, so a neighbouring file (or
   * another sink's files in the same directory) is never touched.
   *
   * @param now Defaults to the current instant.
   * @returns The number of files deleted.
   */
  public async prune(now: Date = new Date()): Promise<number> {
    if (this.#retentionDays === 0) {
      return 0;
    }

    const directory = this.directory();
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return 0;
    }

    const cutoffInstant = new Date(now.getTime() - this.#retentionDays * 24 * 60 * 60 * 1000);
    const cutoff = formatDateInZone(cutoffInstant, this.#timezone);
    const pattern = new RegExp(
      `^${escapeRegExp(this.stem())}-(\\d{4}-\\d{2}-\\d{2})${escapeRegExp(this.extensionSuffix())}$`,
    );

    let deleted = 0;
    for (const name of entries) {
      const match = pattern.exec(name);
      if (match === null) {
        continue;
      }

      // Y-m-d sorts correctly as a plain string comparison.
      const fileDate = match[1] ?? '';
      if (fileDate >= cutoff) {
        continue;
      }

      try {
        await unlink(join(directory, name));
        deleted++;
      } catch {
        // Intentionally swallowed: a file another process removed first
        // (or one this process cannot delete) is not counted.
      }
    }

    return deleted;
  }

  /**
   * Forget which base paths have been pruned.
   *
   * @internal Exposed for the package's own test suite so each test can
   * start from a clean, unpruned state.
   */
  public static resetPruneState(): void {
    pruned.clear();
  }

  /**
   * Run {@link FileSink.prune} at most once per process for this base path.
   */
  private async pruneOnce(now: Date): Promise<void> {
    if (pruned.has(this.#basePath)) {
      return;
    }

    pruned.add(this.#basePath);
    await this.prune(now);
  }

  /**
   * Directory containing the base path.
   */
  private directory(): string {
    return dirname(this.#basePath);
  }

  /**
   * Filename without its last extension.
   *
   * Only the last extension is split off: `"client.debug.log"` has stem
   * `"client.debug"`, not `"client"`.
   */
  private stem(): string {
    const file = basename(this.#basePath);
    const extension = extname(file);

    if (extension === '') {
      return file;
    }

    return file.slice(0, -extension.length);
  }

  /**
   * Extension of the base path (including the leading dot), or an empty
   * string when there is none. Case is preserved.
   */
  private extensionSuffix(): string {
    return extname(basename(this.#basePath));
  }
}
