import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Label } from '@rmartz/github';

const listLabels = vi.fn();
const createLabel = vi.fn();
const updateLabel = vi.fn();

vi.mock('@rmartz/github', () => ({ listLabels, createLabel, updateLabel }));

const { ensureLabels } = await import('../src/ensure-labels.js');

const spec = (name: string, color: string, description: string, renamedFrom?: string[]) => ({
  name,
  color,
  description,
  ...(renamedFrom ? { renamedFrom } : {}),
});

beforeEach(() => {
  listLabels.mockReset();
  createLabel.mockReset().mockResolvedValue('ok');
  updateLabel.mockReset().mockResolvedValue('ok');
});

describe('ensureLabels', () => {
  it('throws when the initial label list fails (no state to diff)', async () => {
    listLabels.mockResolvedValueOnce(null);
    await expect(ensureLabels('r/r')).rejects.toThrow(/failed to list labels/);
  });

  it('creates an absent label', async () => {
    listLabels.mockResolvedValueOnce([]);
    const res = await ensureLabels('r/r', { roster: [spec('Auth', '6B7280', 'a')] });
    expect(createLabel).toHaveBeenCalledWith('r/r', 'Auth', '6B7280', 'a', {});
    expect(res.outcomes).toEqual([{ name: 'Auth', action: 'created' }]);
    expect(res.failures).toEqual([]);
  });

  it('leaves a matching label unchanged (no write)', async () => {
    const live: Label[] = [{ name: 'Auth', color: '6B7280', description: 'a' }];
    listLabels.mockResolvedValueOnce(live);
    const res = await ensureLabels('r/r', { roster: [spec('Auth', '6B7280', 'a')] });
    expect(createLabel).not.toHaveBeenCalled();
    expect(updateLabel).not.toHaveBeenCalled();
    expect(res.outcomes).toEqual([{ name: 'Auth', action: 'unchanged' }]);
  });

  it('treats a leading # and case differences in color as a match', async () => {
    const live: Label[] = [{ name: 'Auth', color: '#6b7280', description: 'a' }];
    listLabels.mockResolvedValueOnce(live);
    const res = await ensureLabels('r/r', { roster: [spec('Auth', '6B7280', 'a')] });
    expect(updateLabel).not.toHaveBeenCalled();
    expect(res.outcomes[0]?.action).toBe('unchanged');
  });

  it('updates a label whose description drifted', async () => {
    const live: Label[] = [{ name: 'Auth', color: '6B7280', description: 'old' }];
    listLabels.mockResolvedValueOnce(live);
    const res = await ensureLabels('r/r', { roster: [spec('Auth', '6B7280', 'new')] });
    expect(updateLabel).toHaveBeenCalledWith('r/r', 'Auth', '6B7280', 'new', {}, {});
    expect(res.outcomes[0]?.action).toBe('updated');
  });

  it('renames in place when only the casing differs', async () => {
    const live: Label[] = [{ name: 'auth', color: '6B7280', description: 'a' }];
    listLabels.mockResolvedValueOnce(live);
    const res = await ensureLabels('r/r', { roster: [spec('Auth', '6B7280', 'a')] });
    expect(updateLabel).toHaveBeenCalledWith('r/r', 'auth', '6B7280', 'a', { newName: 'Auth' }, {});
    expect(res.outcomes[0]).toEqual({ name: 'Auth', action: 'renamed', from: 'auth' });
  });

  it('renames a renamedFrom predecessor that still exists', async () => {
    const live: Label[] = [{ name: 'CI loosening approved', color: '22C55E', description: 'x' }];
    listLabels.mockResolvedValueOnce(live);
    const res = await ensureLabels('r/r', {
      roster: [spec('CI change approved', '22C55E', 'x', ['CI loosening approved'])],
    });
    expect(updateLabel).toHaveBeenCalledWith(
      'r/r',
      'CI loosening approved',
      '22C55E',
      'x',
      { newName: 'CI change approved' },
      {},
    );
    expect(res.outcomes[0]).toEqual({
      name: 'CI change approved',
      action: 'renamed',
      from: 'CI loosening approved',
    });
    expect(createLabel).not.toHaveBeenCalled();
  });

  it('collects per-label failures without throwing and still attempts later labels', async () => {
    listLabels.mockResolvedValueOnce([]);
    createLabel.mockResolvedValueOnce(null).mockResolvedValueOnce('ok');
    const res = await ensureLabels('r/r', {
      roster: [spec('Auth', '6B7280', 'a'), spec('UI', '7C6FA5', 'b')],
    });
    expect(createLabel).toHaveBeenCalledTimes(2);
    expect(res.failures).toEqual(['Auth']);
    expect(res.outcomes[1]).toEqual({ name: 'UI', action: 'created' });
  });

  it('reconciles the default roster (cross-cutting + meta) when no roster is given', async () => {
    listLabels.mockResolvedValueOnce([]);
    const res = await ensureLabels('r/r');
    const names = res.outcomes.map((o) => o.name);
    expect(names).toContain('Auth');
    expect(names).toContain('tracking');
    expect(names).toContain('discussion');
  });
});
