import { describe, expect, it } from 'vitest';
import { isSampleEvent, visibleEvents } from './visible-events.js';

describe('visible events', () => {
  it('hides sample events from pickers', () => {
    const events = [
      { id: 'a', name: 'Peep', is_sample: false },
      { id: 'b', name: 'Walkthrough', is_sample: true },
      { id: 'c', name: 'Live' },
    ];
    expect(visibleEvents(events).map((event) => event.id)).toEqual(['a', 'c']);
    expect(isSampleEvent(events[1])).toBe(true);
    expect(isSampleEvent(events[0])).toBe(false);
    expect(isSampleEvent(null)).toBe(false);
  });
});
