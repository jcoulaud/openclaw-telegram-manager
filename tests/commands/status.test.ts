import { describe, it, expect } from 'vitest';
import { formatStatus } from '../../src/commands/status.js';
import type { StatusData } from '../../src/commands/status.js';

describe('formatStatus', () => {
  const baseData: StatusData = {
    name: 'My Project',
    type: 'coding',
    statusContent: [
      '# Status: My Project',
      '',
      '## Last done (UTC)',
      '',
      '2026-02-13T10:30:00Z Implemented the login flow',
      '',
      '## Next 3 actions (now)',
      '',
      '1. Add tests for auth',
      '2. Deploy to staging',
      '3. Review PR #42',
      '',
      '## Upcoming actions',
      '',
      '- Refactor user model',
      '- Add rate limiting',
    ].join('\n'),
    todoContent: null,
    expanded: false,
  };

  it('should always include goal block (name + type)', () => {
    const result = formatStatus(baseData);
    expect(result).toContain('**My Project**');
    expect(result).toContain('coding');
  });

  it('should include last activity timestamp', () => {
    const result = formatStatus(baseData);
    expect(result).toContain('Last activity');
  });

  it('should include done recently section when content exists', () => {
    const result = formatStatus(baseData);
    expect(result).toContain('Done recently');
    expect(result).toContain('Implemented the login flow');
  });

  it('should always include next actions section', () => {
    const result = formatStatus(baseData);
    expect(result).toContain('Next actions');
    expect(result).toContain('Add tests for auth');
  });

  it('should not include upcoming section in compact mode', () => {
    const result = formatStatus(baseData);
    expect(result).not.toContain('Upcoming');
    expect(result).not.toContain('Refactor user model');
  });

  it('should include upcoming section in expanded mode', () => {
    const result = formatStatus({ ...baseData, expanded: true });
    expect(result).toContain('Upcoming');
    expect(result).toContain('Refactor user model');
  });

  it('should not show blockers when none exist', () => {
    const result = formatStatus(baseData);
    expect(result).not.toContain('Blockers');
  });

  it('should show blockers when present in TODO.md', () => {
    const todoContent = [
      '## Tasks',
      '',
      '- [x] Setup project',
      '- [ ] [BLOCKED] Waiting for API access',
      '- [ ] Deploy',
    ].join('\n');

    const result = formatStatus({ ...baseData, todoContent });
    expect(result).toContain('Blockers');
    expect(result).toContain('BLOCKED');
  });

  it('should show "None yet" for next actions when section is empty', () => {
    const statusContent = [
      '# Status: My Project',
      '',
      '## Next 3 actions (now)',
      '',
      '_None yet._',
    ].join('\n');

    const result = formatStatus({ ...baseData, statusContent });
    expect(result).toContain('Next actions');
    expect(result).toContain('None yet');
  });

  it('should handle minimal status file (no done section)', () => {
    const statusContent = [
      '# Status: My Project',
      '',
      '## Next 3 actions (now)',
      '',
      '1. Start working',
    ].join('\n');

    const result = formatStatus({ ...baseData, statusContent });
    expect(result).toContain('**My Project**');
    expect(result).toContain('Next actions');
    expect(result).not.toContain('Done recently');
  });
});
