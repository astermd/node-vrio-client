import { describe, expect, it } from 'vitest';
import { Offer } from '../src/offer.js';

describe('Offer', () => {
  it('describes a search request', () => {
    const spec = new Offer().searchOffer({ campaign_id: 'camp_1' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('offers');
    expect(spec.query).toEqual({ campaign_id: 'camp_1' });
    expect(spec.fields).toEqual({});
  });

  it('defaults to no query parameters', () => {
    expect(new Offer().searchOffer().query).toEqual({});
  });
});
