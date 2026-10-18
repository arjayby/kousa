# Identify Websites by exact hostname within each Workspace

Each Website represents one exact hostname, so apex, www, and other subdomains are separate analytics properties. Normalized hostnames are unique within a Workspace, but another Workspace can register the same hostname because registration does not prove domain ownership. This preserves explicit reporting boundaries and permits independent Workspace setup, while accepting separate configuration for www and other subdomains instead of automatic grouping or a global domain claim.
