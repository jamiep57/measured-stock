export function isSampleEvent(event) {
  return event?.is_sample === true;
}

export function visibleEvents(events) {
  return (events || []).filter((event) => !isSampleEvent(event));
}
