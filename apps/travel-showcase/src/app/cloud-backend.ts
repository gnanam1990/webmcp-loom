import {
  createOpenAiCompatibleCloudRuntimeModel,
  type OpenAiCompatibleCloudRuntimeModelOptions,
} from '@webmcp-loom/model-adapters';
import type { BackendState, SessionModelFactory } from './session.js';

const DEFAULT_LABEL = 'Configured cloud model';
const MAX_LABEL_CHARACTERS = 80;

export interface TravelCloudBackendOptions extends OpenAiCompatibleCloudRuntimeModelOptions {
  /** Human-readable provider/model name. Endpoints and credentials never belong in this label. */
  label?: string;
}

/** The exact application options needed to select the configured cloud model. */
export interface TravelCloudBackend {
  backend: BackendState;
  createModel: SessionModelFactory;
}

/**
 * Connects the travel application to the bounded cloud adapter without adding
 * a browser credential form, environment-secret convention, or provider SDK.
 *
 * A trusted host owns the endpoint and the short-lived credential resolver.
 * The resolver is invoked by the adapter for each request; returned credential
 * headers are not retained by this integration.
 */
export function createTravelCloudBackend(
  options: TravelCloudBackendOptions,
): TravelCloudBackend {
  const { label: requestedLabel, ...adapterOptions } = options;
  const label = normalizeLabel(requestedLabel);
  const model = createOpenAiCompatibleCloudRuntimeModel(adapterOptions);
  const descriptor = Object.freeze({
    id: 'openai-compatible-cloud',
    kind: 'cloud' as const,
    label,
    detail: 'Prompts are sent to the explicitly configured HTTPS model endpoint. Tool policy and approval stay in the shared runtime.',
  });

  return Object.freeze({
    backend: Object.freeze({ status: 'ready' as const, backend: descriptor }),
    createModel: () => model,
  });
}

function normalizeLabel(value: string | undefined): string {
  if (value === undefined) return DEFAULT_LABEL;
  const label = value.trim();
  if (!label) throw new Error('Cloud backend label must not be empty.');
  const hasControlCharacter = [...label].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (label.length > MAX_LABEL_CHARACTERS || hasControlCharacter) {
    throw new Error(`Cloud backend label must be plain text no longer than ${MAX_LABEL_CHARACTERS} characters.`);
  }
  return label;
}
