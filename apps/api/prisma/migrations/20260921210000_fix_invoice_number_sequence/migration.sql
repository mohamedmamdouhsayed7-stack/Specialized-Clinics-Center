-- Fix invoice_number_seq to ensure nextval returns the next unique number
-- The previous migration used setval with the max existing invoice number,
-- but the default is_called=true semantics caused sequence drift.
--
-- Correct semantics:
-- If highest existing invoice is INV-000125 (num=125),
-- next generated invoice MUST be INV-000126 (num=126).
--
-- Using setval(seq, value, false) sets the sequence current value to 'value'
-- and the next nextval() call will return 'value' (not value + 1).

DO $$
DECLARE max_num BIGINT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber", 5) AS BIGINT)), 0) INTO max_num
  FROM "Invoice"
  WHERE "invoiceNumber" ~ '^INV-[0-9]+$';

  -- Set sequence to max + 1 with is_called=false
  -- This ensures the next nextval() returns max + 1
  IF max_num >= 0 THEN
    PERFORM setval('invoice_number_seq', max_num + 1, false);
  END IF;
END $$;
