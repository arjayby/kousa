# Runtime and delivery boundaries

Read this reference when implementing queue consumers, payment webhooks, retries, or resources that outlive a single operation.

## Worker and Effect lifetimes

Create request-specific services from the current Worker bindings. Reuse immutable configuration when useful, but never share mutable tenant or actor state between requests.

Acquire and release database clients within the operation's scope. Follow the driver and Hyperdrive lifecycle requirements. Do not keep connections in module-level mutable state without verifying runtime support. Ensure Effect scopes finalize on completion, failure, and interruption.

Await work that determines a response or queue acknowledgement. For optional background work, use the platform's supported lifetime mechanism. Detached fibers and in-memory retry schedules do not make work durable after a Worker invocation ends.

Verify the installed versions before adopting examples from the [oRPC Effect integration](https://orpc.dev/docs/integrations/effect). Consult the [Effect services migration guide](https://github.com/Effect-TS/effect/blob/main/migration/services.md) when adapting older service definitions; use release-matched examples for actual code.

## Queue delivery

[Cloudflare Queues provides at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/). Treat duplicate messages as normal. Effect's in-memory Queue and retry operators do not replace Cloudflare's durable queue.

Validate message payloads with a versioned schema. Include stable event IDs and tenant identifiers. Process messages through feature operations rather than invoking HTTP routers internally.

Define what successful processing persists before acknowledging a message. Acknowledge only after that work succeeds. Retry transient failures with bounded attempts; route permanently invalid messages and exhausted retries to an explicit dead-letter or rejection policy. Record that decision instead of silently discarding data.

Partition batch outcomes so one failed message does not cause unnecessary reprocessing of successful messages. Make database writes replay-safe even when the acknowledgement fails after a successful write.

Choose where retries happen. Short Effect retries may handle a transient operation within one invocation. Cloudflare handles delivery retries across invocations. Account for both in the timeout and attempt budget. Authorization failures, invalid inputs, and business conflicts generally require a different outcome from network failures.

## Payments and multiple data stores

Verify a webhook's signature against its original payload before trusting its content. Use provider event IDs for durable deduplication. Do not assume webhook arrival order matches business event order.

Use idempotency keys for provider operations when supported. Retrying an Effect program is not proof that its side effects are safe to repeat.

A PostgreSQL transaction cannot atomically include a ClickHouse write or an external API call. For operations spanning systems, define durable progress, replay, and reconciliation. Add an outbox when reliable publication requires it; do not require one for unrelated reads. Do not mark a workflow complete before all required effects have a recovery strategy.

Keep logs in Evlog and visitor analytics in their event storage. Record request or event ID, tenant ID, operation, attempts, duration, and outcome. Avoid full event payloads, payment secrets, and direct personal identifiers when they are unnecessary for diagnosis.
