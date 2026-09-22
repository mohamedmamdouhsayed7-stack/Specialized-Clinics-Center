-- Update InvoiceItem.serviceId foreign key to SET NULL on delete
-- This allows Service deletion while preserving invoice history

-- Drop the existing foreign key constraint
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_serviceId_fkey";

-- Add the new foreign key constraint with ON DELETE SET NULL
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_serviceId_fkey" 
  FOREIGN KEY ("serviceId") 
  REFERENCES "Service"("id") 
  ON DELETE SET NULL 
  ON UPDATE CASCADE;
