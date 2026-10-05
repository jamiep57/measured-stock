import { describe, expect, it } from 'vitest';
import { renderAccessSection } from './access.js';

describe('access settings', () => {
  it('hides the sysadmin column and developer tools from a non-sysadmin', () => {
    const html = renderAccessSection();
    expect(html).toContain('User');
    expect(html).toContain('Manager');
    expect(html).toContain('Admin');
    expect(html).not.toContain('Sysadmin');
    expect(html).not.toContain('Bug inbox');
    expect(html).toContain('Menu &amp; GP');
    expect(html).toContain('Edit product information');
  });
});
