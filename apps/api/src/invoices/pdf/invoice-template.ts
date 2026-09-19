import { CLINIC_LOGO_BASE64 } from './clinic-logo';
import { Decimal } from '@prisma/client/runtime/library';

// Loose shape matching InvoicesService.findOne()'s include (invoiceItems + service.code,
// patient, visit + diagnosis, payments). Kept local (rather than importing Prisma's
// generated types) so this template has no dependency beyond the plain data it's handed.
export interface InvoicePdfData {
  invoiceNumber: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  subtotal: number | string | Decimal;
  total: number | string | Decimal;
  paid: number | string | Decimal;
  remaining: number | string | Decimal;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  issuedAt?: string | Date | null;
  createdAt: string | Date;
  replacedByInvoiceId?: string | null;
  patient: {
    fullNameAr: string;
    civilId: string | null;
    phone?: string | null;
  };
  visit?: {
    type: 'CHECKUP' | 'FOLLOW_UP' | 'OTHER';
    diagnosis?: string | null;
  } | null;
  invoiceItems: Array<{
    serviceNameSnapshot: string;
    unitPriceSnapshot: number | string | Decimal;
    quantity: number;
    lineTotal: number | string | Decimal;
    service?: { code: string | null } | null;
  }>;
  additionalCharges?: Array<{
    chargeType: 'PERCENTAGE' | 'FIXED';
    chargeValue: number | string | Decimal;
    calculatedAmount: number | string | Decimal;
    description?: string | null;
  }>;
  payments: Array<{
    amount: number | string | Decimal;
    method: 'CASH' | 'VISA' | 'KNET' | 'LINK' | 'OTHER';
    paymentDate: string | Date;
    status?: 'RECORDED' | 'REVERSED';
  }>;
}

// Re-exported so callers (e.g. the invoices controller) can keep writing
// `import { InvoiceLocale } from './invoice-template'` exactly like before —
// this file previously exported this type and the controller depends on it.
export type InvoiceLocale = 'ar' | 'en';

// Fixed clinic identity — single-doctor clinic, this never changes per invoice.
const DOCTOR_NAME_AR = 'د. نداء بوخضور';
const DOCTOR_TITLE_AR = 'استشاري أمراض النساء والولادة والعقم';

const CLINIC_NAME_AR = 'مركز العيادات التخصصية';
const CLINIC_NAME_EN = 'Specialized Clinics Center';

// Address/contact are English-only on the invoice per the latest client
// request — no Arabic address lines anywhere on the printed document.
const CLINIC_ADDRESS_EN = "Hawally - Block 4 - Al-Motasim St. - Specialized Clinics Center - 6th Floor";
const CLINIC_PHONE_EN = 'Tel.: 22650700 ext. 607';
const CLINIC_MOBILE_EN = 'Mobile & WhatsApp: 60008977';

const PAYMENT_METHOD_LABELS_EN: Record<InvoicePdfData['payments'][number]['method'], string> = {

  KNET: 'KNET',
  LINK: 'LINK',
  CASH: 'CASH',
  VISA: 'VISA',
  OTHER: 'OTHER',

};

function formatMoney(value: number | string | Decimal): string {
  return new Decimal(String(value)).toDecimalPlaces(2).toFixed(2);
}

function formatDate(value: string | Date): string {
  // Use Asia/Kuwait timezone for clinic invoice dates
  const d = new Date(value);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuwait',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return formatter.format(d).replace(/\//g, '/');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inline SVG icons (feather-style) ──
// Plain emoji aren't used because headless Chromium in the PDF-rendering
// container has no color-emoji font installed — SVG paths need no font.
const ICON_PATHS: Record<string, string> = {
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-5 5-7 8-7s6.5 2 8 7"/>',
  idCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 10h6M13 14h4"/>',
  phone: '<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.2c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1z"/>',
  mapPin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>',
  coins:
    '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M3 11v4c0 1.7 2.7 3 6 3 .9 0 1.8-.1 2.5-.4"/><ellipse cx="17" cy="14.5" rx="4.5" ry="2.5"/><path d="M12.5 14.5v3c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5v-3"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
};

function icon(name: keyof typeof ICON_PATHS, size = 16): string {
  return `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}

// ── One compact invoice copy (used twice per printed page) ──
interface InvoiceLabels {
  invoice: string;
  invoiceNo: string;
  date: string;
  patientName: string;
  civilId: string;
  mobile: string;
  visitType: string;
  diagnosis: string;
  service: string;
  code: string;
  qty: string;
  unitPrice: string;
  total: string;
  paid: string;
  remaining: string;
  paymentStatus: string;
  paymentMethod: string;
  additional: string;
  fixed: string;
  percentage: string;
  paymentMethods: Record<InvoicePdfData['payments'][number]['method'], string>;
}

function renderInvoiceCopy(
  invoice: InvoicePdfData,
  language: InvoiceLocale,
  labels: InvoiceLabels,
): string {
  const isArabic = language === 'ar';

  const itemsRows = invoice.invoiceItems
    .map(
      (item) => `
        <tr>
          <td class="col-service">${escapeHtml(item.serviceNameSnapshot)}</td>
          <td class="col-code">${item.service?.code ? escapeHtml(item.service.code) : '&mdash;'}</td>
          <td class="col-qty">${item.quantity}</td>
          <td class="col-price">${formatMoney(item.unitPriceSnapshot)}</td>
          <td class="col-total">${formatMoney(item.lineTotal)}</td>
        </tr>`,
    )
    .join('');

  const chargesRows = (invoice.additionalCharges || [])
    .map((charge) => {
      const chargeLabel = charge.description
        ? escapeHtml(charge.description)
        : charge.chargeType === 'PERCENTAGE'
          ? labels.percentage
          : labels.fixed;
      const priceDisplay =
        charge.chargeType === 'PERCENTAGE' ? formatMoney(charge.chargeValue) + '%' : formatMoney(charge.chargeValue);
      return `
        <tr class="charge-row">
          <td class="col-service">${chargeLabel}</td>
          <td class="col-code">&mdash;</td>
          <td class="col-qty">1</td>
          <td class="col-price">${priceDisplay}</td>
          <td class="col-total">${formatMoney(charge.calculatedAmount)}</td>
        </tr>`;
    })
    .join('');

  const lastPayment = invoice.payments.length > 0 ? invoice.payments[invoice.payments.length - 1] : null;
  const visitType = invoice.visit
    ? (isArabic
      ? { CHECKUP: 'فحص', FOLLOW_UP: 'متابعة', OTHER: 'أخرى' }[invoice.visit.type]
      : { CHECKUP: 'Checkup', FOLLOW_UP: 'Follow-up', OTHER: 'Other' }[invoice.visit.type])
    : '&mdash;';
  const diagnosis = invoice.visit?.diagnosis ? escapeHtml(invoice.visit.diagnosis) : '&mdash;';
  const paymentStatus = isArabic
    ? { UNPAID: 'غير مدفوع', PARTIALLY_PAID: 'مدفوع جزئياً', PAID: 'مدفوع بالكامل' }[invoice.paymentStatus]
    : invoice.paymentStatus.replace('_', ' ');
  const voidWatermark = invoice.status === 'VOID' ? `<div class="watermark">VOID</div>` : '';
  const replacementNote = invoice.replacedByInvoiceId
    ? `<div class="replacement-note">${isArabic ? 'تم استبدال هذه الفاتورة.' : 'This invoice has been replaced.'}</div>`
    : '';

  return `
  <div class="copy">
    ${voidWatermark}
    <div class="top-bar"></div>
    <div class="c-header">
      <img class="logo" src="data:image/png;base64,${CLINIC_LOGO_BASE64}" alt="${CLINIC_NAME_EN}" />
      <div class="clinic-name">
        <div class="clinic-name-ar">${CLINIC_NAME_AR}</div>
        <div class="clinic-name-en">${CLINIC_NAME_EN}</div>
      </div>
      <div class="divider"></div>
      <div class="doctor-info">
        <div class="doctor-name">${DOCTOR_NAME_AR}</div>
        <div class="doctor-title">${DOCTOR_TITLE_AR}</div>
      </div>
    </div>

    <div class="title-row">
      <div class="invoice-title">${labels.invoice}</div>
      <div class="meta-inline">
        <span class="meta-chip"><b>${labels.invoiceNo}:</b> ${escapeHtml(invoice.invoiceNumber)}</span>
        <span class="meta-chip"><b>${labels.date}:</b> ${formatDate(invoice.issuedAt || invoice.createdAt)}</span>
      </div>
    </div>

    <div class="patient-row">
      <div class="p-field">
        <span class="p-label">${labels.patientName}:</span>
        <span class="p-value ar">${escapeHtml(invoice.patient.fullNameAr)}</span>
      </div>
      <div class="p-field">
        <span class="p-label">${labels.civilId}:</span>
        <span class="p-value">${invoice.patient.civilId ? escapeHtml(invoice.patient.civilId) : '&mdash;'}</span>
      </div>
      <div class="p-field">
        <span class="p-label">${labels.mobile}:</span>
        <span class="p-value">${invoice.patient.phone ? escapeHtml(invoice.patient.phone) : '&mdash;'}</span>
      </div>
      <div class="p-field">
        <span class="p-label">${labels.visitType}:</span>
        <span class="p-value">${visitType}</span>
      </div>
      <div class="p-field diagnosis-field">
        <span class="p-label">${labels.diagnosis}:</span>
        <span class="p-value ar">${diagnosis}</span>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="col-service">${labels.service}</th>
          <th class="col-code">${labels.code}</th>
          <th class="col-qty">${labels.qty}</th>
          <th class="col-price">${labels.unitPrice}</th>
          <th class="col-total">${labels.total}</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
        ${chargesRows}
      </tbody>
    </table>

    ${replacementNote}

    <div class="pay-row">
      <div class="pay-box">
        <span class="pay-label">${labels.total}:</span>
        <span class="pay-value">${formatMoney(invoice.total)} KD</span>
      </div>
      <div class="pay-box">
        <span class="pay-label">${labels.paid}:</span>
        <span class="pay-value">${formatMoney(invoice.paid)} KD</span>
      </div>
      <div class="pay-box">
        <span class="pay-label">${labels.remaining}:</span>
        <span class="pay-value">${formatMoney(invoice.remaining)} KD</span>
      </div>
      <div class="pay-box">
        <span class="pay-label">${labels.paymentMethod}:</span>
        <span class="pay-value">${lastPayment ? labels.paymentMethods[lastPayment.method] : '&mdash;'}</span>
      </div>
      <div class="pay-box">
        <span class="pay-label">${labels.paymentStatus}:</span>
        <span class="pay-value">${paymentStatus}</span>
      </div>
    </div>

    <div class="copy-footer">
      <span class="cf-item">${icon('mapPin', 8)} ${CLINIC_ADDRESS_EN}</span>
      <span class="cf-sep">&middot;</span>
      <span class="cf-item">${icon('phone', 8)} ${CLINIC_PHONE_EN}</span>
      <span class="cf-sep">&middot;</span>
      <span class="cf-item">${CLINIC_MOBILE_EN}</span>
    </div>

    <div class="thanks">&#9829; ${isArabic ? 'شكرًا لاختياركم عيادتنا' : 'Thank you for choosing our clinic'} &#9829;</div>
  </div>`;
}

export function renderInvoiceHtml(invoice: InvoicePdfData, language: InvoiceLocale = 'ar'): string {
  const isArabic = language === 'ar';
  const labels = isArabic
    ? {
      invoice: 'فاتورة',
      invoiceNo: 'رقم الفاتورة',
      date: 'التاريخ',
      patientName: 'اسم المريض',
      civilId: 'الرقم المدني',
      mobile: 'رقم الهاتف',
      visitType: 'نوع الزيارة',
      diagnosis: 'التشخيص',
      service: 'الخدمة',
      code: 'الرمز',
      qty: 'الكمية',
      unitPrice: 'سعر الوحدة (د.ك)',
      total: 'الإجمالي (د.ك)',
      paid: 'المدفوع',
      remaining: 'المتبقي',
      paymentStatus: 'حالة الدفع',
      paymentMethod: 'طريقة الدفع',
      additional: 'رسوم إضافية',
      fixed: 'رسوم ثابتة',
      percentage: 'رسوم إضافية',
      paymentMethods: {
        CASH: 'نقدي',
        VISA: 'فيزا',
        LINK: 'لينك',
        KNET: 'كي نت',
        OTHER: 'أخرى',
      },
    }
    : {
      invoice: 'INVOICE',
      invoiceNo: 'Invoice No.',
      date: 'Date',
      patientName: 'Patient Name',
      civilId: 'Civil ID',
      mobile: 'Mobile Number',
      visitType: 'Visit Type',
      diagnosis: 'Diagnosis',
      service: 'SERVICE',
      code: 'CODE',
      qty: 'QTY',
      unitPrice: 'UNIT PRICE (KD)',
      total: 'TOTAL (KD)',
      paid: 'Paid',
      remaining: 'Remaining',
      paymentStatus: 'Payment Status',
      paymentMethod: 'PAYMENT METHOD',
      additional: 'Additional Charges',
      fixed: 'Fixed Charge',
      percentage: 'Additional Charge',
      paymentMethods: PAYMENT_METHOD_LABELS_EN,
    };

  const copyHtml = renderInvoiceCopy(invoice, language, labels);

  return `
<!DOCTYPE html>
<html lang="${language}" dir="${isArabic ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8" />
<style>
  @font-face { font-family: 'Noto Naskh Arabic'; src: local('Noto Naskh Arabic'); }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body {
    font-family: 'Arial', 'Noto Sans Arabic', 'Noto Naskh Arabic', sans-serif;
    color: #1F2430;
    margin: 0;
    padding: 0;
    background: #FFFFFF;
  }
  .sheet {
    width: 210mm;
    min-height: 297mm;
    padding: 4mm 8mm;
    display: flex;
    flex-direction: column;
    gap: 3mm;
  }
  .cut-line {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #AEB9CC;
    font-size: 7px;
  }
  .cut-line .dashes {
    flex: 1;
    border-top: 1.5px dashed #C7D2E3;
  }
  .copy {
    flex: 0 0 auto;
    position: relative;
    padding: 3mm 5mm;
    display: flex;
    flex-direction: column;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .watermark {
    position: absolute;
    top: 35%;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 60px;
    font-weight: bold;
    color: #C4362B;
    opacity: 0.15;
    transform: rotate(-25deg);
    z-index: 10;
  }
  .top-bar { height: 2.5px; width: 100%; border-radius: 999px; background: #C4362B; margin-bottom: 5px; }
  .c-header {
    display: grid;
    grid-template-columns: 34px minmax(0,1fr) auto minmax(120px,1fr);
    align-items: center;
    gap: 7px;
    padding-bottom: 5px;
    border-bottom: 1px solid #E1E6EF;
    margin-bottom: 5px;
  }
  .c-header .logo { width: 32px; height: 32px; object-fit: contain; }
  .clinic-name-ar {
    font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif;
    font-size: 11px; font-weight: bold; color: #102F63; direction: rtl;
  }
  .clinic-name-en { font-size: 9px; font-weight: 700; color: #102F63; }
  .divider { width: 1px; align-self: stretch; background: #DCE3EE; }
  .doctor-info { text-align: right; }
  .doctor-info .doctor-name {
    font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif;
    font-size: 11px; font-weight: bold; color: #102F63; direction: rtl;
  }
  .doctor-info .doctor-title {
    font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif;
    font-size: 7.5px; color: #4B5694; direction: rtl; margin-top: 1px;
  }
  .c-icon { flex: 0 0 8px; width: 8px; height: 8px; color: #4B5694; }
  .c-icon svg { display: block; width: 8px; height: 8px; }
  .title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
  .invoice-title { font-size: 13px; font-weight: 800; color: #111844; letter-spacing: 1px; }
  .invoice-title .arrow { color: #4B5694; font-weight: normal; padding: 0 5px; }
  .meta-inline { display: flex; gap: 6px; }
  .meta-chip {
    display: inline-block;
    background: #F3F7FC;
    padding: 2px 6px;
    font-size: 7.5px;
    color: #102F63;
  }
  .meta-chip b { font-weight: 700; }
  .patient-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-bottom: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #EEF1F6;
  }
  .p-field { flex: 1 1 calc(33.333% - 4px); display: flex; align-items: baseline; gap: 2px; min-width: 0; font-size: 7.5px; }
  .diagnosis-field { flex-basis: calc(66.666% - 4px); }
  .p-label { color: #7D879B; flex-shrink: 0; }
  .p-value { font-weight: bold; color: #1F2430; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p-value.ar { font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif; direction: rtl; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.items th { background: #102F63; color: #FFFFFF; padding: 2px 4px; font-size: 6.5px; text-align: ${isArabic ? 'right' : 'left'}; }
  table.items td { padding: 2px 4px; font-size: 7px; border-bottom: 1px solid #EEF1F6; }
  table.items tr:nth-child(even) td { background: #F7F9FC; }
  table.items tr.charge-row td { background: #FFF6EC; font-style: italic; }
  .col-qty, .col-price, .col-total, .col-code { text-align: center; }
  table.items th.col-qty, table.items th.col-price, table.items th.col-total, table.items th.col-code { text-align: center; }
  .replacement-note {
    text-align: center; font-size: 7.5px; color: #C4362B; font-weight: bold;
    margin-bottom: 4px; padding: 3px; border: 1px solid #E0A09A; border-radius: 4px; background: #FFF5F4;
  }
  .pay-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
    margin-bottom: 4px;
    padding-top: 4px;
    border-top: 1px solid #EEF1F6;
  }
  .pay-box {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: 2px;
    min-width: 0;
  }
  .pay-label { font-size: 6.5px; color: #7D879B; text-transform: uppercase; }
  .pay-value { font-size: 8px; font-weight: bold; color: #102F63; }
  .copy-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 6px;
    color: #4B5694;
    border-top: 1px solid #EEF1F6;
    padding-top: 3px;
    margin-bottom: 2px;
  }
  .copy-footer .cf-item { display: inline-flex; align-items: center; gap: 2px; }
  .copy-footer .cf-item svg { flex-shrink: 0; }
  .copy-footer .cf-sep { color: #C7D2E3; }
  .thanks { text-align: center; font-style: italic; font-size: 6.5px; color: #4B5694; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="sheet">
    ${copyHtml}
    <div class="cut-line"><span class="dashes"></span>&#9986;<span class="dashes"></span></div>
    ${copyHtml}
  </div>
</body>
</html>`;
}

// Re-added — this existed in the previous version of this file and is kept
// for compatibility with any caller (frontend or backend) that imports it.
// Only pre-fills a WhatsApp message; WhatsApp does not allow attaching a
// file via a wa.me link, so the user still attaches the downloaded PDF
// manually inside the chat that opens.
export function buildWhatsAppShareUrl(
  patientPhone: string,
  invoiceNumber: string,
  language: InvoiceLocale = 'ar',
): string {
  const digitsOnly = patientPhone.replace(/[^\d]/g, '');
  const message =
    language === 'ar'
      ? `مرفق فاتورتكم رقم ${invoiceNumber} من مركز العيادات التخصصية.`
      : `Attached is your invoice No. ${invoiceNumber} from Specialized Clinics Center.`;
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}
