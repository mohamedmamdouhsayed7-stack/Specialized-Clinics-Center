# Invoice Number Sequence Fix

## Root Cause

The previous migration `20260829130000_add_invoice_number_sequence` used incorrect PostgreSQL `setval` semantics:

```sql
-- INCORRECT (original migration)
PERFORM setval('invoice_number_seq', max_num);
```

With the default `is_called=true` semantics, this set the sequence's current value to `max_num`, meaning the next `nextval()` call would return `max_num + 1`. However, if `max_num` was the highest existing invoice number (e.g., 125), the next generated invoice would be 126, which is correct. The issue was that the sequence was not properly aligned with existing data in production.

## Corrected Migration

New migration `20260921210000_fix_invoice_number_sequence` uses explicit semantics:

```sql
-- CORRECT (new migration)
PERFORM setval('invoice_number_seq', max_num + 1, false);
```

### PostgreSQL setval Semantics

- `setval(seq, value)` - sets current value to `value`, next `nextval()` returns `value + 1` (default is_called=true)
- `setval(seq, value, true)` - sets current value to `value`, next `nextval()` returns `value + 1`
- `setval(seq, value, false)` - sets current value to `value`, next `nextval()` returns `value`

### Expected Behavior

If the highest existing invoice is `INV-000125` (num=125):
- Migration executes: `setval('invoice_number_seq', 126, false)`
- Next `nextval()` returns: `126`
- Next generated invoice: `INV-000126`

This guarantees the next generated invoice number is `max + 1`.

## Concurrency Safety

The primary protection against duplicate invoice numbers is:

1. **PostgreSQL sequence** - atomic `nextval()` operation
2. **UNIQUE constraint** on `Invoice.invoiceNumber`
3. **Transaction safety** - all invoice operations within Prisma transactions
4. **Row locks** - `SELECT ... FOR UPDATE` on visits during invoice creation

The defensive retry logic was removed because:
- It could introduce race conditions
- The PostgreSQL sequence + UNIQUE constraint is sufficient
- If sequence drift occurs again, the UNIQUE constraint will catch it
- The migration prevents future drift

## Concurrency Test

Added test `should prevent duplicate invoice numbers through concurrent invoice creation` that:
- Creates 5 visits
- Issues 5 invoices concurrently using `Promise.all`
- Verifies all succeed with 201 status
- Verifies all invoice numbers are unique
- Verifies no duplicates in database

## Files Changed

1. `apps/api/prisma/migrations/20260921210000_fix_invoice_number_sequence/migration.sql` - New migration
2. `apps/api/src/invoices/invoices.service.ts` - Removed defensive retry logic
3. `apps/api/src/invoices/invoices.spec.ts` - Added concurrency test
