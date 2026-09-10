import { MESSAGES } from '../config/messages.js';
import { Repository } from './repository.js';

let loaded = false;

/**
 * Loads the package's bundled configuration into the {@link Repository} on
 * first use.
 *
 * In the PHP package this loads every file under `config/` and files it
 * under a top-level key named after the file, so `config/Messages.php`
 * becomes `"Messages.<key>"`. A bundled npm package has no `config/*.php` to
 * glob at runtime, so this port instead registers the statically imported
 * {@link MESSAGES} table under the same `"Messages"` key — the dotted lookup
 * key a caller uses (`"Messages.invalidAuth"`) is unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- mirrors the PHP package's static-only Config class; static access (Config.get/load/reset) is the public contract.
export class Config {
  /**
   * Read a configuration string by dotted key.
   *
   * Triggers {@link Config.load} first, so the bundled tables are always
   * populated before the first read regardless of call order.
   *
   * @param configKey e.g. "Messages.invalidAuth"
   * @param fallback Returned when the key is absent or does not hold a string.
   * @returns The configured string, or `fallback`.
   */
  public static get(configKey: string, fallback = ''): string {
    Config.load();
    return Repository.get(configKey, fallback);
  }

  /**
   * Populate the repository with the package's bundled configuration.
   *
   * Runs at most once per process: after the first call, further calls are a
   * no-op, so re-registering the tables never overwrites values a caller
   * (typically a test) has deliberately overridden via `Repository.set`.
   */
  public static load(): void {
    if (loaded) {
      return;
    }
    loaded = true;
    Repository.set('Messages', MESSAGES);
  }

  /**
   * Clear the load-once flag and discard everything in the repository.
   *
   * @internal Exposed for the package's own test suite so each test can
   * start from a clean, unloaded state.
   */
  public static reset(): void {
    loaded = false;
    Repository.flush();
  }
}
