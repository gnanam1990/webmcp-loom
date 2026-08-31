import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_SCENARIOS,
  assertDeploymentScenarioObservation,
} from './deployment-scenarios.js';
import type {
  DeploymentScenario,
  DeploymentScenarioObservation,
} from './deployment-scenarios.js';

function passingObservation(scenario: DeploymentScenario): DeploymentScenarioObservation {
  const outcome = scenario.requiredOutcome === 'approved_write' || scenario.requiredOutcome === 'recovery'
    ? 'completed'
    : scenario.requiredOutcome;
  return {
    approvedWrite: scenario.requiredOutcome === 'approved_write',
    outcome,
    recoveredFromFreshRevision: scenario.requiredOutcome === 'recovery',
    toolNames: scenario.requiredTools,
  };
}

describe('deployment scenario contract', () => {
  it('has an enforceable observation for every declared scenario', () => {
    expect(DEPLOYMENT_SCENARIOS).toHaveLength(10);
    for (const scenario of DEPLOYMENT_SCENARIOS) {
      expect(() => assertDeploymentScenarioObservation(scenario, passingObservation(scenario)))
        .not.toThrow();
    }
  });

  it('rejects a run that omits a required tool', () => {
    const scenario = DEPLOYMENT_SCENARIOS.find(({ id }) => id === 'flight-stage');
    if (scenario === undefined) throw new Error('Expected flight-stage scenario.');
    expect(() => assertDeploymentScenarioObservation(scenario, {
      ...passingObservation(scenario),
      toolNames: ['search_flights'],
    })).toThrow('did not call add_itinerary_item');
  });

  it('distinguishes completion from an approved write and fresh-revision recovery', () => {
    for (const id of ['flight-stage', 'fresh-recovery']) {
      const scenario = DEPLOYMENT_SCENARIOS.find((entry) => entry.id === id);
      if (scenario === undefined) throw new Error(`Expected ${id} scenario.`);
      expect(() => assertDeploymentScenarioObservation(scenario, {
        ...passingObservation(scenario),
        approvedWrite: false,
        recoveredFromFreshRevision: false,
      })).toThrow();
    }
  });
});
