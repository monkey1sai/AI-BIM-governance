// Moved to src/coordinatorClient (docs/architecture/coordinator-browser-client-adr.md); the viewer builds its client with
// createCoordinatorClient. This re-export keeps the remaining importers working until ADR §4 bullet 2 removes it.
export {
  CoordinatorHttpError,
  QueuedForInstanceError,
  isQueuedForInstanceError,
  type StageBindingArtifact,
  type StageBindingCredentials,
  type StageBindingPreauthorization,
  type StageBindingRevisions,
} from "../coordinatorClient";
