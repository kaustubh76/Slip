-- vault_deleted_at joins the mandate's set-once fields: once PayPal has confirmed the vaulted
-- payment method is deleted, that record cannot be changed or cleared. Same function as in
-- 0001_guards.sql with that one addition.
CREATE OR REPLACE FUNCTION "slip_mandates_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'mandate %: mandates are never deleted', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'PENDING' OR NEW.vault_id_ciphertext IS NOT NULL THEN
			RAISE EXCEPTION 'mandate %: a mandate starts PENDING with no vault id', NEW.id
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN NEW;
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'mandate %: id, owner and creation time are immutable', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF (OLD.setup_order_id IS NOT NULL AND NEW.setup_order_id IS DISTINCT FROM OLD.setup_order_id)
		OR (OLD.paypal_customer_id IS NOT NULL AND NEW.paypal_customer_id IS DISTINCT FROM OLD.paypal_customer_id)
		OR (OLD.vault_id_ciphertext IS NOT NULL AND NEW.vault_id_ciphertext IS DISTINCT FROM OLD.vault_id_ciphertext)
		OR (OLD.vault_id_hmac IS NOT NULL AND NEW.vault_id_hmac IS DISTINCT FROM OLD.vault_id_hmac)
		OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
		OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
		OR (OLD.vault_deleted_at IS NOT NULL AND NEW.vault_deleted_at IS DISTINCT FROM OLD.vault_deleted_at) THEN
		RAISE EXCEPTION 'mandate %: setup order, vault id and timestamps are set once', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status <> OLD.status AND NOT EXISTS (
		SELECT 1 FROM "slip_mandate_transitions" t
		WHERE t.from_status = OLD.status AND t.to_status = NEW.status
	) THEN
		RAISE EXCEPTION 'mandate %: cannot move from % to %', OLD.id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
