# Kousa owns workspace authorization

Each Workspace has exactly one Owner, and ownership transfers must preserve that invariant atomically. Kousa owns Workspace, Membership, Invitation, and ownership-transfer operations through its Effect backend and PostgreSQL, while Better Auth provides login and email verification. Better Auth's organization plugin permits multiple Owners and exposes independent mutation routes, so we accept maintaining these operations to keep one enforcement path.
