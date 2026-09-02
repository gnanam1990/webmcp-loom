# Model adapters

`@webmcp-loom/model-adapters` implements the runtime's model-neutral
`RuntimeModel` contract for local llama.cpp, local Ollama, browser WebLLM, and
explicitly configured OpenAI-compatible cloud endpoints. An adapter supplies
untrusted text only; validation, tool policy, approval, stale-state detection,
and execution remain inside `@webmcp-loom/runtime`.

## OpenAI-compatible cloud contract

The cloud adapter requires an exact HTTPS chat-completions endpoint and a
request-time credential-header resolver. It does not choose a provider, read an
environment variable, retain a credential, follow redirects, retry a write, or
make a request during construction.

```ts
import { createOpenAiCompatibleCloudRuntimeModel } from '@webmcp-loom/model-adapters';

const model = createOpenAiCompatibleCloudRuntimeModel({
  endpoint: configuredEndpoint,
  model: configuredModel,
  resolveCredentialHeaders: async ({ signal }) => ({
    authorization: `Bearer ${await credentialStore.read({ signal })}`,
  }),
});
```

The resolver runs once per model decision so a host can rotate short-lived
credentials. It receives the same operation signal as the network request.
Protected and hop-by-hop headers are rejected; the adapter owns JSON request
and response headers. Caller cancellation and the configured whole-operation
timeout cover both credential resolution and the request.

The wire request forwards the runtime's phase-specific JSON Schema unchanged
using the OpenAI-compatible `json_schema` response format. Provider responses
are size-bounded, decoded as UTF-8 JSON, and must contain non-empty assistant
message content. Transport, authentication, rate-limit, malformed-response,
timeout, and cancellation failures are normalized without including provider
response bodies or credentials in error messages.

## Evidence boundary

Unit and runtime-integration tests use an injected `fetch` implementation and
synthetic credentials. They prove contract mapping, cancellation, bounded
failure behavior, and that a cloud-produced write decision still pauses at the
runtime approval boundary. They do not prove compatibility with a particular
provider, model quality, latency, memory, production credentials, or public
deployment. Those require a separately approved provider run and retained
benchmark evidence.
