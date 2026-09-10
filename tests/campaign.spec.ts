import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/campaign.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('Campaign', () => {
  it('describes a campaign items request', () => {
    const spec = new Campaign().getCampaignItems('camp_1', { with: 'offers' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('campaigns/camp_1/items');
    expect(spec.query).toEqual({ with: 'offers' });
    expect(spec.fields).toEqual({});
  });

  it('defaults to no query parameters', () => {
    expect(new Campaign().getCampaignItems('camp_1').query).toEqual({});
  });

  it('requires a campaign id', () => {
    expect(() => new Campaign().getCampaignItems('')).toThrow(VrioError);
    expect(() => new Campaign().getCampaignItems('')).toThrow('Missing required fields');
  });
});
