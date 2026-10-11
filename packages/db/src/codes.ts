/**
 * `ConflictError` codes. Both stores raise exactly these, so callers branch on the code and the
 * contract suite checks the Postgres store and the fake raise the same one for the same case.
 * The Postgres store gets them by mapping unique-constraint names (see `pg/errors.ts`).
 */
export const Conflict = {
  OWNER_EXISTS: "OWNER_EXISTS",
  EMAIL_IN_USE: "EMAIL_IN_USE",
  MANDATE_EXISTS: "MANDATE_EXISTS",
  MANDATE_NOT_PENDING: "MANDATE_NOT_PENDING",
  SETUP_ORDER_SET: "SETUP_ORDER_SET",
  SETUP_ORDER_IN_USE: "SETUP_ORDER_IN_USE",
  MANDATE_VAULT_SET: "MANDATE_VAULT_SET",
  VAULT_ID_IN_USE: "VAULT_ID_IN_USE",
  AGENT_EXISTS: "AGENT_EXISTS",
  AGENT_REVOKED: "AGENT_REVOKED",
  API_KEY_IN_USE: "API_KEY_IN_USE",
  SNAPSHOT_EXISTS: "SNAPSHOT_EXISTS",
  ATTEMPT_EXISTS: "ATTEMPT_EXISTS",
  CHILD_ATTEMPT_EXISTS: "CHILD_ATTEMPT_EXISTS",
  PAYMENT_IN_FLIGHT: "PAYMENT_IN_FLIGHT",
  PAYPAL_ID_IN_USE: "PAYPAL_ID_IN_USE",
  REQUEST_ID_IN_USE: "REQUEST_ID_IN_USE",
  PAYMENT_FIELD_SET: "PAYMENT_FIELD_SET",
  OPERATION_EXISTS: "OPERATION_EXISTS",
  HOLD_NOT_EXPIRED: "HOLD_NOT_EXPIRED",
} as const;
export type ConflictCode = (typeof Conflict)[keyof typeof Conflict];

/** Unique constraint (or index) name → conflict code. Primary keys are `<table>_pkey`. */
export const UNIQUE_CONSTRAINT_CODES: Readonly<Record<string, ConflictCode>> = {
  owners_pkey: Conflict.OWNER_EXISTS,
  owners_email_unique: Conflict.EMAIL_IN_USE,
  mandates_pkey: Conflict.MANDATE_EXISTS,
  mandates_setup_order_unique: Conflict.SETUP_ORDER_IN_USE,
  mandates_vault_hmac_unique: Conflict.VAULT_ID_IN_USE,
  agents_pkey: Conflict.AGENT_EXISTS,
  agents_api_key_hash_unique: Conflict.API_KEY_IN_USE,
  offer_snapshots_pkey: Conflict.SNAPSHOT_EXISTS,
  attempts_pkey: Conflict.ATTEMPT_EXISTS,
  attempts_parent_unique: Conflict.CHILD_ATTEMPT_EXISTS,
  payments_in_flight_unique: Conflict.PAYMENT_IN_FLIGHT,
  payments_paypal_order_unique: Conflict.PAYPAL_ID_IN_USE,
  payments_authorization_unique: Conflict.PAYPAL_ID_IN_USE,
  payments_capture_unique: Conflict.PAYPAL_ID_IN_USE,
  payment_operations_request_unique: Conflict.REQUEST_ID_IN_USE,
  payment_operations_pk: Conflict.OPERATION_EXISTS,
};

/** Page sizes outside this range are refused rather than silently clamped. */
export const MAX_PAGE_SIZE = 500;
