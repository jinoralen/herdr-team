// Compose ownership journals and the lock that serializes reconciliation.
export {
  type Deployment,
  deleteDeployment,
  deployments,
  type ManagedAgent,
  type ManagedTab,
  rootDir,
  saveDeployment,
  withDeploymentLock,
} from './store.ts';
