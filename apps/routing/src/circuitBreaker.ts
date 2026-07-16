export type AgentHealthState = "up" | "down" | "circuit-open";

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

interface AgentCircuitState {
  failureTimestamps: number[];
  circuitOpenUntil: number;
}

const circuitStateByAgent = new Map<string, AgentCircuitState>();

function getOrCreateState(agentName: string): AgentCircuitState {
  let state = circuitStateByAgent.get(agentName);
  if (!state) {
    state = {
      failureTimestamps: [],
      circuitOpenUntil: 0
    };
    circuitStateByAgent.set(agentName, state);
  }

  return state;
}

function pruneFailures(state: AgentCircuitState, now: number): void {
  state.failureTimestamps = state.failureTimestamps.filter(
    (timestamp) => now - timestamp <= FAILURE_WINDOW_MS
  );
}

export function isCircuitOpen(agentName: string, now: number = Date.now()): boolean {
  const state = getOrCreateState(agentName);
  return state.circuitOpenUntil > now;
}

export function recordAgentFailure(
  agentName: string,
  now: number = Date.now()
): { failureCount: number; circuitOpened: boolean; circuitOpenUntil: number } {
  const state = getOrCreateState(agentName);

  pruneFailures(state, now);
  state.failureTimestamps.push(now);
  const failureCount = state.failureTimestamps.length;

  let circuitOpened = false;
  if (failureCount >= FAILURE_THRESHOLD) {
    state.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
    state.failureTimestamps = [];
    circuitOpened = true;
  }

  return {
    failureCount,
    circuitOpened,
    circuitOpenUntil: state.circuitOpenUntil
  };
}

export function recordAgentSuccess(agentName: string): void {
  const state = getOrCreateState(agentName);
  state.failureTimestamps = [];
  state.circuitOpenUntil = 0;
}

export function getAgentHealth(agentName: string, now: number = Date.now()): AgentHealthState {
  const state = getOrCreateState(agentName);

  if (state.circuitOpenUntil > now) {
    return "circuit-open";
  }

  pruneFailures(state, now);

  if (state.failureTimestamps.length > 0) {
    return "down";
  }

  return "up";
}

export function getAgentsHealth(
  agentNames: string[],
  now: number = Date.now()
): Record<string, AgentHealthState> {
  return agentNames.reduce<Record<string, AgentHealthState>>((acc, agentName) => {
    acc[agentName] = getAgentHealth(agentName, now);
    return acc;
  }, {});
}
