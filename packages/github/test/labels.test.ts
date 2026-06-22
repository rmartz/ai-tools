import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });

const { listLabels, createLabel, updateLabel, removeLabel } = await import('../src/labels.js');

describe('listLabels', () => {
  beforeEach(() => boundedRun.mockReset());

  it('parses the REST primary NDJSON (one object per line)', async () => {
    boundedRun.mockResolvedValueOnce(
      ok(
        '{"name":"Auth","color":"d73a4a","description":"a"}\n' +
          '{"name":"UI","color":"0e8a16","description":null}\n',
      ),
    );
    const labels = await listLabels('r/r');
    expect(labels).toEqual([
      { name: 'Auth', color: 'd73a4a', description: 'a' },
      { name: 'UI', color: '0e8a16', description: null },
    ]);
  });

  it('parses the GraphQL fallback single array', async () => {
    boundedRun.mockResolvedValueOnce(ok('[{"name":"Security","color":"b60205","description":""}]'));
    const labels = await listLabels('r/r');
    expect(labels).toEqual([{ name: 'Security', color: 'b60205', description: '' }]);
  });

  it('returns [] for empty output', async () => {
    boundedRun.mockResolvedValueOnce(ok('   '));
    expect(await listLabels('r/r')).toEqual([]);
  });
});

describe('createLabel', () => {
  beforeEach(() => boundedRun.mockReset());

  it('strips a leading # from the color before sending', async () => {
    boundedRun.mockResolvedValueOnce(ok('done'));
    await createLabel('r/r', 'Auth', '#d73a4a', 'desc');
    const [, , opts] = boundedRun.mock.calls[0];
    expect(opts.input).toContain('"color":"d73a4a"');
    expect(opts.input).not.toContain('#');
  });
});

describe('updateLabel', () => {
  beforeEach(() => boundedRun.mockReset());

  it('sends new_name only when renaming to a different name', async () => {
    boundedRun.mockResolvedValueOnce(ok('done'));
    await updateLabel('r/r', 'tech debt', 'ededed', 'd', { newName: 'Tech Debt' });
    const [, , opts] = boundedRun.mock.calls[0];
    expect(opts.input).toContain('"new_name":"Tech Debt"');
  });

  it('omits new_name when the name is unchanged', async () => {
    boundedRun.mockResolvedValueOnce(ok('done'));
    await updateLabel('r/r', 'Auth', 'ededed', 'd', { newName: 'Auth' });
    const [, , opts] = boundedRun.mock.calls[0];
    expect(opts.input).not.toContain('new_name');
  });
});

describe('removeLabel', () => {
  beforeEach(() => boundedRun.mockReset());

  it('URL-encodes a label name with spaces in the REST path', async () => {
    boundedRun.mockResolvedValueOnce(ok(''));
    await removeLabel('r/r', 5, 'review requested');
    const [, args] = boundedRun.mock.calls[0];
    expect(args).toContain('repos/r/r/issues/5/labels/review%20requested');
  });
});
