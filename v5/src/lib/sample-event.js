/**
 * Hidden practice event used by the admin walkthrough.
 */

import { getDB } from '../db.js';

export { isSampleEvent, visibleEvents } from './visible-events.js';

export const SAMPLE_EVENT_NAME = 'Walkthrough';

export async function ensureSampleEvent({ reset = false } = {}) {
  const DB = getDB();
  const id = await DB.rpc('ensure_walkthrough_event', { p_reset: !!reset });
  if (!id) throw new Error('Could not open the practice event');
  const row = await DB.events.get(id, 'id,name,status,is_sample,image_url');
  return row || {
    id,
    name: SAMPLE_EVENT_NAME,
    status: 'draft',
    is_sample: true,
    image_url: null,
  };
}
