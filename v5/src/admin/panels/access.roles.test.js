import { describe, expect, it, vi } from 'vitest';

const profile = {
  role: 'admin',
  active_org_id: 'org-1',
  organisations: [{ id: 'org-1', name: 'Main', role: 'admin' }],
};

vi.mock('../../lib/auth.js', () => ({
  getCachedProfile: () => profile,
}));

vi.mock('../../lib/organisations.js', () => ({
  isSysadmin: () => profile.role === 'sysadmin',
}));

const { renderAccessSection } = await import('./access.js');

function switchTag(html, role, feature) {
  const flat = html.replace(/\s+/g, ' ');
  const match = flat.match(new RegExp(
    `<button type="button" class="access-switch[^"]*" role="switch"[^>]*data-access-role="${role}" data-access-feature="${feature}"[^>]*>`,
  ));
  return match ? match[0] : '';
}

describe('access grid by viewer', () => {
  it('shows an admin the three roles, with Users and Access locked on', () => {
    profile.role = 'admin';
    const html = renderAccessSection();
    expect(html).toContain('>User<');
    expect(html).toContain('>Manager<');
    expect(html).toContain('>Admin<');
    expect(html).not.toContain('>Sysadmin<');
    expect(html).not.toContain('Bug inbox');
    expect(switchTag(html, 'admin', 'workspace.users')).toContain('disabled');
    expect(switchTag(html, 'admin', 'workspace.access')).toContain('disabled');
    expect(switchTag(html, 'user', 'stock.deliveries')).not.toContain('disabled');
    expect(switchTag(html, 'manager', 'dev.bugs')).toBe('');
  });

  it('shows a sysadmin the developer rows and a locked sysadmin column', () => {
    profile.role = 'sysadmin';
    const html = renderAccessSection();
    expect(html).toContain('>Sysadmin<');
    expect(html).toContain('Bug inbox');
    expect(html).toContain('Forensic audit');
    expect(html).toContain('Backup');
    expect(switchTag(html, 'sysadmin', 'home.dashboard')).toContain('disabled');
    expect(switchTag(html, 'admin', 'workspace.access')).toContain('disabled');
    expect(switchTag(html, 'manager', 'dev.bugs')).not.toContain('disabled');
  });
});
