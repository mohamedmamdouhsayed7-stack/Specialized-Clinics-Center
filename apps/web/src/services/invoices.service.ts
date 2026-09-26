
import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { parseApiError } from './api-error';
import { createInvoiceFilename, createShareInvoiceFilename } from '../utils/invoiceFilename';

export interface InvoiceItem {
  id: string;
  serviceId: string;
  serviceNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
  service?: {
    code: string | null;
  };
}

export interface AdditionalCharge {
  id: string;
  chargeType: 'PERCENTAGE' | 'FIXED';
  chargeValue: string;
  calculatedAmount: string;
  description: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  visitId: string;
  patientId: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  subtotal: string;
  total: string;
  paid: string;
  remaining: string;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
  invoiceItems: InvoiceItem[];
  additionalCharges?: AdditionalCharge[];
  replacedByInvoiceId?: string | null;
  replacedInvoiceId?: string | null;
  patient: {
    id: string;
    civilId: string | null;
    fullNameAr: string;
    fullNameEn?: string | null;
    phone?: string;
  };
  visit: {
    id: string;
    type: string;
    visitDate: string;
    diagnosis?: string | null;
  };
}

export interface CreateInvoiceItemDto {
  serviceId: string;
  quantity: number;
  unitPrice?: number;
}

export interface CreateInvoiceDto {
  visitId: string;
  items: CreateInvoiceItemDto[];
  additionalCharges?: {
    chargeType: 'PERCENTAGE' | 'FIXED';
    chargeValue: number;
    description?: string;
  }[];
  paymentMethod: 'KNET' | 'LINK' | 'OTHER';
}

export interface AddChargeDto {
  chargeType: 'PERCENTAGE' | 'FIXED';
  chargeValue: number;
  description?: string;
}

export interface CreateReplacementDto {
  items: CreateInvoiceItemDto[];
  additionalCharges?: {
    chargeType: 'PERCENTAGE' | 'FIXED';
    chargeValue: number;
    description?: string;
  }[];
  paymentMethod?: 'KNET' | 'LINK' | 'OTHER';
}

export interface InvoicesListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}


export function parseContentDispositionFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;

  const header = contentDisposition;

  const rfc5987Match = header.match(/filename\*\s*=\s*([^';]+)'(?:[^']*)'([^;]+)/i);
  if (rfc5987Match) {
    const charset = rfc5987Match[1].trim().toUpperCase();
    const encoded = rfc5987Match[2].trim();
    if (charset === 'UTF-8' || charset === 'UTF8') {
      try {
        return decodeURIComponent(encoded);
      } catch (e) {
        void e;
      }
    }
  }

  const quotedMatch = header.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quotedMatch) {
    return quotedMatch[1].replace(/\\(.)/g, '$1');
  }

  const unquotedMatch = header.match(/filename\s*=\s*([^;]+)/i);
  if (unquotedMatch) {
    return unquotedMatch[1].trim();
  }

  return null;
}

function containsIllegalFilenameCharacters(value: string): boolean {
  const symbols = '<>:"/\\|?*';
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n <= 0x1f) return true;
    if (symbols.indexOf(value.charAt(i)) >= 0) return true;
  }
  return false;
}

export function isSafeInvoiceFilename(filename: unknown, invoiceNumber?: string): filename is string {
  if (typeof filename !== 'string') return false;
  if (!filename.endsWith('.pdf')) return false;
  if (!filename.startsWith('Invoice - ')) return false;
  if (invoiceNumber && !filename.includes(invoiceNumber)) return false;
  if (containsIllegalFilenameCharacters(filename)) return false;
  if (/\.\./.test(filename.split(/[\\/]/).pop() || '')) return false;
  return true;
}

class InvoicesService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getInvoices(
    patientId?: string,
    status?: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
  ): Promise<InvoicesListResponse> {
    const params = new URLSearchParams();
    if (patientId) params.append('patientId', patientId);
    if (status) params.append('status', status);
    if (search?.trim()) params.append('search', search.trim());
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const response = await fetch(`${apiBaseUrl}/invoices?${params.toString()}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch invoices');
    }

    return response.json();
  }

  async getInvoice(id: string): Promise<Invoice> {
    const response = await fetch(`${apiBaseUrl}/invoices/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch invoice');
    }

    return response.json();
  }

  async deleteInvoicePermanently(id: string): Promise<{ id: string; deleted: boolean }> {
    const response = await fetch(`${apiBaseUrl}/invoices/${id}/permanent`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, 'Failed to permanently delete invoice');
    }
    return response.json();
  }

  private async fetchPdf(url: string, errorMessage: string): Promise<{ blob: Blob; contentDisposition: string | null }> {
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw await parseApiError(response, errorMessage);
    const contentDisposition = response.headers.get('Content-Disposition');
    const blob = await response.blob();
    return { blob, contentDisposition };
  }

  private resolveInvoiceFilename(
    contentDispositionHeader: string | null,
    fallbackPatientName: string,
    fallbackInvoiceNumber: string,
  ): string {
    const parsed = parseContentDispositionFilename(contentDispositionHeader);
    if (isSafeInvoiceFilename(parsed, fallbackInvoiceNumber)) {
      return parsed;
    }
    return createInvoiceFilename(fallbackPatientName, fallbackInvoiceNumber);
  }

  async getPdfBlob(id: string, language: 'ar' | 'en'): Promise<Blob> {
    const { blob } = await this.fetchPdf(
      `${apiBaseUrl}/invoices/${id}/pdf?lang=${language}`,
      'Failed to download invoice PDF',
    );
    return blob;
  }

  async getSharePdfBlob(id: string, language: 'ar' | 'en'): Promise<Blob> {
    const { blob } = await this.fetchPdf(
      `${apiBaseUrl}/invoices/${id}/pdf/share?lang=${language}`,
      'Failed to prepare invoice for sharing',
    );
    return blob;
  }

  async getPdfFile(id: string, language: 'ar' | 'en', patientName: string, invoiceNumber: string): Promise<globalThis.File> {
    const { blob, contentDisposition } = await this.fetchPdf(
      `${apiBaseUrl}/invoices/${id}/pdf?lang=${language}`,
      'Failed to download invoice PDF',
    );
    const filename = this.resolveInvoiceFilename(contentDisposition, patientName, invoiceNumber);
    return new globalThis.File([blob], filename, { type: 'application/pdf' });
  }

  async getSharePdfFile(
    id: string,
    language: 'ar' | 'en',
    patient: { fullNameAr: string; fullNameEn?: string | null; civilId?: string | null } | null | undefined,
    invoiceNumber: string,
  ): Promise<globalThis.File> {
    const { blob } = await this.fetchPdf(
      `${apiBaseUrl}/invoices/${id}/pdf/share?lang=${language}`,
      'Failed to prepare invoice for sharing',
    );
    const safePatient = patient
      ? patient
      : { fullNameAr: '' };
    const filename = createShareInvoiceFilename(safePatient, invoiceNumber);
    return new globalThis.File([blob], filename, { type: 'application/pdf' });
  }

  async downloadPdf(id: string, language: 'ar' | 'en', patientName: string, invoiceNumber: string): Promise<void> {
    const { blob, contentDisposition } = await this.fetchPdf(
      `${apiBaseUrl}/invoices/${id}/pdf?lang=${language}`,
      'Failed to download invoice PDF',
    );
    const filename = this.resolveInvoiceFilename(contentDisposition, patientName, invoiceNumber);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  async createInvoice(data: CreateInvoiceDto): Promise<Invoice> {
    const response = await fetch(`${apiBaseUrl}/invoices`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to create invoice');
    }

    return response.json();
  }

  async updateInvoiceStatus(
    id: string,
    status: 'DRAFT' | 'ISSUED' | 'VOID',
    paymentMethod?: 'KNET' | 'LINK' | 'OTHER',
  ): Promise<Invoice> {
    const response = await fetch(`${apiBaseUrl}/invoices/${id}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        status,
        ...(paymentMethod && { paymentMethod }),
      }),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update invoice status');
    }

    return response.json();
  }

  async addCharge(invoiceId: string, chargeData: AddChargeDto): Promise<Invoice> {
    const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/charges`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(chargeData),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to add charge');
    }

    return response.json();
  }

  async createReplacement(invoiceId: string, replacementData: CreateReplacementDto): Promise<Invoice> {
    const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/replacement`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(replacementData),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to create replacement');
    }

    return response.json();
  }
}

export const invoicesService = new InvoicesService();
