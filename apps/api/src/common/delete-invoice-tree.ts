import { Prisma } from '@prisma/client';

/** Delete invoices and their financial dependents without crossing the requested invoice scope. */
export async function deleteInvoiceTree(tx: Prisma.TransactionClient, invoiceIds: string[]): Promise<void> {
  if (invoiceIds.length === 0) return;

  // Allocations are dependent on both a source payment and a credited invoice.
  // Remove only allocations touching this deletion tree; preserve external payments.
  await tx.paymentAllocation.deleteMany({
    where: {
      OR: [
        { invoiceId: { in: invoiceIds } },
        { payment: { invoiceId: { in: invoiceIds } } },
      ],
    },
  });

  // Surviving invoices may point at invoices in this tree as replacements.
  // Clear only those links, leaving every external invoice and payment intact.
  await tx.invoice.updateMany({
    where: { replacedByInvoiceId: { in: invoiceIds } },
    data: { replacedByInvoiceId: null },
  });

  await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await tx.invoiceAdditionalCharge.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
}
