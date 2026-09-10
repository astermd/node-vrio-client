import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Campaign endpoints.
 *
 * A campaign groups the offers a storefront can sell. This resource exposes
 * the campaign's item list, which is what a storefront reads to render its
 * catalogue before a cart exists.
 */
export class Campaign extends Vrio {
  /**
   * Return every item belonging to a campaign.
   *
   * `GET /campaigns/{campaignId}/items`
   *
   * @param campaignId Identifier of the campaign to read.
   * @param params     Optional query parameters; see the API reference in
   *                   your AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the campaign ID is empty.
   */
  public getCampaignItems(campaignId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (campaignId === '') {
      this.requiredFields();
    }

    return this.sendGet(`campaigns/${campaignId}/items`, params);
  }
}
