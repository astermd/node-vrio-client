/**
 * In-memory configuration store with dotted-key lookup.
 *
 * Deliberately dependency-free: the package needs somewhere to keep a handful
 * of message strings, which is not a reason to drag a framework into every
 * consumer's dependency tree.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- mirrors the PHP package's static-only Repository class; static access (Repository.get/set/flush) is the public contract.
export class Repository {
  private static config: Record<string, unknown> = {};

  /**
   * Read the string stored at a dotted key.
   *
   * Walks the stored tree one segment at a time. If any segment along the
   * way is missing, or the segment does not lead into a plain object, or the
   * value found at the end of the walk is not a string, the fallback is
   * returned instead — callers never have to guard against `undefined` or
   * non-string config values themselves.
   *
   * @param configKey e.g. "Messages.methodNotFound"
   * @param fallback Returned when the key is absent or does not hold a string.
   * @returns The stored string, or `fallback`.
   */
  public static get(configKey: string, fallback = ''): string {
    if (configKey === '') {
      return fallback;
    }

    let value: unknown = Repository.config;
    for (const segment of configKey.split('.')) {
      if (typeof value !== 'object' || value === null || !(segment in value)) {
        return fallback;
      }
      value = (value as Record<string, unknown>)[segment];
    }

    return typeof value === 'string' ? value : fallback;
  }

  /**
   * Store a value under a top-level key.
   *
   * An empty key is refused rather than silently stored, since it can never
   * be read back through {@link Repository.get} (which also refuses empty
   * keys).
   *
   * @param configKey Top-level key the value is filed under.
   * @param configVal Value to store; typically a plain object of strings.
   * @returns `true` if the value was stored, `false` if `configKey` was empty.
   */
  public static set(configKey: string, configVal: unknown): boolean {
    if (configKey === '') {
      return false;
    }

    Repository.config[configKey] = configVal;

    return true;
  }

  /**
   * Discard everything currently stored.
   *
   * Exposed for the package's own test suite so tests can start from a clean
   * store instead of depending on process load order.
   */
  public static flush(): void {
    Repository.config = {};
  }
}
