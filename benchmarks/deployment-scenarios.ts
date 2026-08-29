export interface DeploymentScenario {
  id: string;
  requiredOutcome: 'approved_write' | 'cancelled' | 'denied' | 'recovery' | 'stale_state' | 'step_limit';
  requiredTools: readonly string[];
  title: string;
}

/** Deployment-parity cases; the runner must assert real WebMCP trace and domain state. */
export const DEPLOYMENT_SCENARIOS: readonly DeploymentScenario[] = [
  { id: 'constraints-read', title: 'Read live trip constraints', requiredOutcome: 'approved_write', requiredTools: ['get_trip_constraints'] },
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
