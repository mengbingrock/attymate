export const MATTER_GET = 'matter:get';
export const MATTER_UPDATE = 'matter:update';
export const MATTER_CREATE = 'matter:create';
export const MATTER_LINK_TEAM = 'matter:link-team';
export const MATTER_UNLINK_TEAM = 'matter:unlink-team';
export const MATTER_GET_LINK_STATUS = 'matter:get-link-status';
export const MATTER_LINK_INITIALIZE = 'matter:link-initialize';
export const MATTER_LINK_REQUEST_REFRESH = 'matter:link-request-refresh';
export const MATTER_LINK_REQUEST_PROPOSAL = 'matter:link-request-proposal';
export const MATTER_REQUEST_REFRESH = 'matter:request-refresh';
export const MATTER_APPLY_PROPOSAL = 'matter:apply-proposal';
export const MATTER_REJECT_PROPOSAL = 'matter:reject-proposal';

/** Main → renderer broadcast after any matter/link/proposal write. */
export const MATTERS_CHANGED_EVENT = 'matter:changed';

export const MATTER_ROUTE = '/api/matter';
