import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LayoutHerdr, Pane } from '@herdr/herdr';
import { type Deployment, deployments, saveDeployment } from '#store';
import { recoverAllocations } from '../allocation.ts';
import { Hub } from '../hub.ts';
import type { Runtime } from '../resources.ts';

function setup(known = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-allocation-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const state: Deployment = {
    room: 'w1',
    name: 'review',
    agents: {},
    tabs: {},
    retired: [],
    allocations: [
      { label: 'allocation', pane: known ? 'owned' : null, tab: known ? 'old-tab' : null },
    ],
  };
  const panes: Pane[] = [
    { pane_id: 'owned', terminal_id: 'owned-terminal', tab_id: 'new-tab', workspace_id: 'w1' },
    { pane_id: 'foreign', terminal_id: 'foreign-terminal', tab_id: 'old-tab', workspace_id: 'w1' },
  ];
  const closed: string[] = [];
  let failClose = false;
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected Herdr operation.');
  };
  const herdr: LayoutHerdr = {
    listPanes: unexpected,
    pane: unexpected,
    prompt: unexpected,
    createTab: unexpected,
    renameTab: unexpected,
    movePane: unexpected,
    startAgent: unexpected,
    listTabs: async () => [],
    listPaneTopology: async () => structuredClone(panes),
    closePane: async (pane) => {
      if (failClose) {
        throw new Error('Close failed.');
      }
      closed.push(pane);
      panes.splice(
        panes.findIndex((p) => p.pane_id === pane),
        1,
      );
    },
  };
  const runtime: Runtime = { root, state, herdr, hub: new Hub({}), lines: [] };
  saveDeployment(root, state);
  return {
    runtime,
    closed,
    panes,
    read: () => deployments(root, 'w1')[0]!,
    failClose: (fail: boolean) => {
      failClose = fail;
    },
  };
}

test('recovery closes a recorded allocation after it moves, preserving unrelated panes', async () => {
  const f = setup();
  await recoverAllocations(f.runtime);
  assert.deepEqual(f.closed, ['owned']);
  assert.deepEqual(
    f.panes.map((p) => p.pane_id),
    ['foreign'],
  );
  assert.deepEqual(f.read().allocations, []);
});

test('recovery retains an unidentified allocation instead of silently forgetting ownership', async () => {
  const f = setup(false);
  f.runtime.herdr.listTabs = async () => [
    { tab_id: 'old-tab', workspace_id: 'w1', label: 'allocation' },
  ];
  f.panes.push({
    pane_id: 'ambiguous',
    terminal_id: 'other',
    tab_id: 'old-tab',
    workspace_id: 'w1',
  });
  await assert.rejects(recoverAllocations(f.runtime), /identify|locate/);
  assert.equal(f.read().allocations.length, 1);
  assert.deepEqual(f.closed, []);
});

test('failed cleanup retains moved allocation ownership until a retry closes it', async () => {
  const f = setup();
  f.failClose(true);
  await assert.rejects(recoverAllocations(f.runtime), /Close failed/);
  assert.equal(f.read().allocations.length, 1);
  f.failClose(false);
  await recoverAllocations(f.runtime);
  assert.deepEqual(f.closed, ['owned']);
  assert.deepEqual(f.read().allocations, []);
});

test('a recorded allocation already absent from live topology can be forgotten safely', async () => {
  const f = setup();
  f.panes.splice(0, 1);
  await recoverAllocations(f.runtime);
  assert.deepEqual(f.closed, []);
  assert.deepEqual(f.read().allocations, []);
});
