import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPlan } from '../manifest.ts';

test('the example team loads with its checked-in definitions', async () => {
  const plan = await loadPlan(
    fileURLToPath(new URL('../../../../../examples/team.yaml', import.meta.url)),
    {},
  );
  assert.equal(plan.name, 'review');
  assert.deepEqual(Object.keys(plan.agents), ['architecture', 'correctness', '$lead']);
  assert.equal(plan.agents.$lead!.kind, 'codex');
});
