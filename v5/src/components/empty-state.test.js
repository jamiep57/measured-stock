import { describe, expect, it } from 'vitest';
import { emptyState, errorState, notFoundState } from './empty-state.js';

describe('emptyState', () => {
  it('renders title, copy, and phosphor icon', () => {
    const html = emptyState({
      icon: 'package',
      title: 'Nothing here',
      copy: 'Add something to get started.',
    });
    expect(html).toContain('empty-title');
    expect(html).toContain('Nothing here');
    expect(html).toContain('Add something to get started.');
    expect(html).toContain('ph-package');
    expect(html).toContain('empty--panel');
  });

  it('includes CTA markup when provided', () => {
    const html = emptyState({
      title: 'Empty',
      ctaHtml: '<button type="button" data-empty-cta>Go</button>',
    });
    expect(html).toContain('empty-cta');
    expect(html).toContain('data-empty-cta');
  });
});

describe('errorState', () => {
  it('marks alert role and retry control', () => {
    const html = errorState({ title: 'Failed', copy: 'Nope' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-empty-retry');
    expect(html).toContain('empty--error');
    expect(html).toContain('ph-warning-circle');
  });

  it('uses inline SVG warning on admin variant', () => {
    const html = errorState({ title: 'Failed', variant: 'admin' });
    expect(html).toContain('<svg');
    expect(html).not.toContain('ph-warning-circle');
  });
});

describe('notFoundState', () => {
  it('wraps admin surface with home link', () => {
    const html = notFoundState({
      surface: 'admin',
      homeHref: '/',
      homeLabel: 'Back to events',
    });
    expect(html).toContain('admin-page');
    expect(html).toContain('admin-not-found');
    expect(html).toContain('href="/"');
    expect(html).toContain('Back to events');
    expect(html).toContain('<svg');
  });
});
