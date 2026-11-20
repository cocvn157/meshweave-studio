// Public read-only workflow contract actions shared with calling Open Agentic Websites
// through MeshWeave Studio's MVP Profile 0.3 action bridge.
import { createMeshActionDefinitions } from '../mesh-actions.js';

export function registerActions(actions) {
  for (const def of createMeshActionDefinitions({
    availability: 'bridge',
    callerOrigins: ['*'],
  })) {
    actions.register(def);
  }
}
