# Kousa

Kousa measures website activity. Workspace access and tracked website activity use separate identities.

## Language

**User**:
A person with a Kousa login.
_Avoid_: Visitor, account

**Visitor**:
A person tracked on a website. An identified Visitor is still separate from a User and has no Kousa access through that identity.
_Avoid_: User

**Workspace**:
The tenant that owns websites and groups Users through membership. A Workspace retains its websites when their creator leaves.
_Avoid_: Account, personal website collection

**Website**:
A separately configured analytics property with one primary hostname that belongs to exactly one Workspace.
_Avoid_: Workspace

**Primary hostname**:
The exact hostname represented by a Website. Apex hostnames, www hostnames, and other subdomains represent separate Websites.
_Avoid_: Website URL, domain group

**Public tracking ID**:
A stable public identifier that identifies one Website for tracking and is distinct from its internal identifier. It grants no access to Website settings or analytics.
_Avoid_: API key, secret, Website ID

**Membership**:
The relationship between a User and a Workspace, with one Role that applies to every Website in that Workspace. A User can have Memberships in several Workspaces, but only one Membership in each.
_Avoid_: Account, subscription

**Role**:
The permissions a User holds through a Membership. The roles are Owner, Admin, and Viewer.
_Avoid_: Global user role

**Owner**:
The single User whose Membership grants control of a Workspace's team and ownership.
_Avoid_: Website creator, billing customer

**Admin**:
A User whose Membership grants website setup and analytics access without control of the Workspace's team or ownership.
_Avoid_: Owner

**Viewer**:
A User whose Membership grants read access to websites and analytics.
_Avoid_: Visitor

**Invitation**:
An offer of Workspace membership addressed to a specific email address and shared through an invitation link.
_Avoid_: Membership, public join link
