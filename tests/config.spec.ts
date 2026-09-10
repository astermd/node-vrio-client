import { beforeEach, describe, expect, it } from 'vitest';
import { Config } from '../src/config.js';
import { Repository } from '../src/repository.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('VrioError', () => {
  it('is an Error with a stable name', () => {
    const error = new VrioError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VrioError);
    expect(error.name).toBe('VrioError');
    expect(error.message).toBe('boom');
  });

  it('survives instanceof through a subclass prototype chain', () => {
    class Sub extends VrioError {}
    expect(new Sub('x')).toBeInstanceOf(VrioError);
  });
});

describe('Config', () => {
  beforeEach(() => {
    Config.reset();
  });

  it('reads a message by dotted key', () => {
    expect(Config.get('Messages.invalidAuth')).toBe('An API key is required');
  });

  it('returns the fallback for an unknown key', () => {
    expect(Config.get('Messages.nope', 'fallback')).toBe('fallback');
  });

  it('returns the fallback for an empty key', () => {
    expect(Config.get('', 'fallback')).toBe('fallback');
  });

  it('returns an empty string when no fallback is given', () => {
    expect(Config.get('Messages.nope')).toBe('');
  });

  it('loads the table only once per process', () => {
    Config.load();
    Repository.set('Messages', { invalidAuth: 'tampered' });
    Config.load();
    expect(Config.get('Messages.invalidAuth')).toBe('tampered');
  });
});

describe('Repository', () => {
  beforeEach(() => {
    Repository.flush();
  });

  it('walks a dotted path', () => {
    Repository.set('Messages', { a: { b: 'deep' } });
    expect(Repository.get('Messages.a.b')).toBe('deep');
  });

  it('returns the fallback when a path segment is missing', () => {
    Repository.set('Messages', { a: 'flat' });
    expect(Repository.get('Messages.a.b', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when the value is not a string', () => {
    Repository.set('Messages', { a: 42 });
    expect(Repository.get('Messages.a', 'fallback')).toBe('fallback');
  });

  it('refuses to store an empty key', () => {
    expect(Repository.set('', 'x')).toBe(false);
  });
});
