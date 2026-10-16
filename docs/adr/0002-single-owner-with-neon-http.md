# Preserve a single Owner across both PostgreSQL drivers

A Workspace references its Owner's Membership through a deferred composite foreign key, and its public Owner Role derives from that reference. Every membership and invitation mutation compares and advances the Workspace revision, with dependent writes in one SQL statement, so concurrent changes fail without applying stale authorization. This accepts revision conflicts that require a refresh instead of interactive transactions, which the current Neon HTTP driver does not support.
