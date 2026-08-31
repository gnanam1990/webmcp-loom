import type { ExpectedRunStatus } from './schema.js';

export interface DeploymentScenario {
  id: string;
  requiredOutcome: 'approved_write' | 'cancelled' | 'completed' | 'denied' | 'recovery' | 'stale_state' | 'step_limit';
  requiredTools: readonly string[];
  title: string;
}

export interface DeploymentScenarioObservation {
  approvedWrite: boolean;
  outcome: ExpectedRunStatus;
  recoveredFromFreshRevision: boolean;
  toolNames: readonly string[];
}

/** Deployment-parity cases; the runner must assert real WebMCP trace and domain state. */
export const DEPLOYMENT_SCENARIOS: readonly DeploymentScenario[] = [
  { id: 'constraints-read', title: 'Read live trip constraints', requiredOutcome: 'completed', requiredTools: ['get_trip_constraints'] },
  { id: 'flight-stage', title: 'Search and stage a non-red-eye flight', requiredOutcome: 'approved_write', requiredTools: ['search_flights', 'add_itinerary_item'] },
  { id: 'stay-stage', title: 'Search and stage a stay', requiredOutcome: 'approved_write', requiredTools: ['search_stays', 'add_itinerary_item'] },
  { id: 'activity-stage', title: 'Search and stage an activity', requiredOutcome: 'approved_write', requiredTools: ['search_activities', 'add_itinerary_item'] },
  { id: 'move-item', title: 'Move a staged item using its itinerary id', requiredOutcome: 'approved_write', requiredTools: ['get_itinerary', 'move_itinerary_item'] },
  { id: 'approval-denial', title: 'Deny a staged write', requiredOutcome: 'denied', requiredTools: ['add_itinerary_item'] },
  { id: 'human-edit-stale', title: 'Stop after a human edit invalidates the plan', requiredOutcome: 'stale_state', requiredTools: ['get_itinerary'] },
  { id: 'fresh-recovery', title: 'Recover from the current revision after a human edit', requiredOutcome: 'recovery', requiredTools: ['get_itinerary', 'add_itinerary_item'] },
  { id: 'cancelled-run', title: 'Cancel without an extra write', requiredOutcome: 'cancelled', requiredTools: [] },
  { id: 'bounded-run', title: 'Stop at the runtime step limit', requiredOutcome: 'step_limit', requiredTools: [] },
];

/**
 * Enforces the deployment-parity declarations against a runner observation.
 * This is the shared assertion boundary; it does not claim that the Day 2
 * deployment runner or its measurements already exist.
 */
export function assertDeploymentScenarioObservation(
  scenario: DeploymentScenario,
  observation: DeploymentScenarioObservation,
): void {
  for (const requiredTool of scenario.requiredTools) {
    if (!observation.toolNames.includes(requiredTool)) {
      throw new Error(`Deployment scenario ${scenario.id} did not call ${requiredTool}.`);
    }
  }

  if (scenario.requiredOutcome === 'approved_write') {
    if (observation.outcome !== 'completed' || !observation.approvedWrite) {
      throw new Error(`Deployment scenario ${scenario.id} requires a completed approved write.`);
    }
    return;
  }
  if (scenario.requiredOutcome === 'recovery') {
    if (observation.outcome !== 'completed' || !observation.recoveredFromFreshRevision) {
      throw new Error(`Deployment scenario ${scenario.id} requires recovery from a fresh revision.`);
    }
    return;
  }
  if (observation.outcome !== scenario.requiredOutcome) {
    throw new Error(
      `Deployment scenario ${scenario.id} expected ${scenario.requiredOutcome}, received ${observation.outcome}.`,
    );
  }
}
