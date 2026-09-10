import { describe, expect, it } from 'vitest';
import { Request } from '../../src/http/request.js';
import { MockHttpClient } from './mock-http-client.js';

describe('MockHttpClient', () => {
  it('does not let a mutation of requests() corrupt its internal state', async () => {
    const client = new MockHttpClient();
    await client.send(new Request('GET', 'https://api.vrio.app/orders'));

    const requests = client.requests() as Request[];
    expect(() => {
      requests.push(new Request('GET', 'https://api.vrio.app/orders/2'));
    }).toThrow();

    expect(client.count()).toBe(1);
  });
});
