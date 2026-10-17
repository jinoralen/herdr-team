import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type Deployment,
  deployments,
  rootDir,
  saveDeployment,
  withDeploymentLock,
} from '../store.ts';

function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-store-'));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const record = (room: string): Deployment => ({
  room,
  name: 'test',
  agents: {},
  tabs: {},
  retired: [],
  allocations: [],
});

test('ownership updates are scoped to a room and survive a fresh connection', () => {
  const root = directory();
  saveDeployment(root, record('w1'));
  saveDeployment(root, record('w2'));
  const state = record('w1');
  state.retired.push({ id: 'tab1', root: null });
  saveDeployment(root, state);
  assert.deepEqual(deployments(root, 'w1'), [state]);
  assert.deepEqual(deployments(root, 'w2'), [record('w2')]);
});

test('up and down cannot overlap and release their lock after a failure', async () => {
  const root = directory();
  await assert.rejects(
    withDeploymentLock(root, async () => {
      await assert.rejects(
        withDeploymentLock(root, async () => {}),
        /Cannot lock deployment/,
      );
      saveDeployment(root, record('w1'));
      throw new Error('remote failure');
    }),
    /remote failure/,
  );
  await withDeploymentLock(root, async () => assert.equal(deployments(root, 'w1').length, 1));
});

test('ownership is scoped to the Herdr session without sharing hub state', () => {
  const base = {
    HERDR_COMPOSE_DIR: '/tmp/compose-test',
    HERDR_SOCKET_PATH: '/tmp/herdr-first.sock',
  };
  assert.notEqual(rootDir(base), rootDir({ ...base, HERDR_SOCKET_PATH: '/tmp/herdr-second.sock' }));
  assert.equal(rootDir({ HERDR_COMPOSE_DIR: '/tmp/compose-test' }), '/tmp/compose-test');
});
