
import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { parseApiError } from './api-error';

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

  async getPdfBlob(id: string, language: 'ar' | 'en'): Promise<Blob> {
    const response = await fetch(`${apiBaseUrl}/invoices/${id}/pdf?lang=${language}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw await parseApiError(response, 'Failed to download invoice PDF');
    return response.blob();
  }

  async getPdfFile(id: string, language: 'ar' | 'en', invoiceNumber: string): Promise<globalThis.File> {
    const blob = await this.getPdfBlob(id, language);
    return new globalThis.File([blob], `invoice-${invoiceNumber}.pdf`, { type: 'application/pdf' });
  }

  async downloadPdf(id: string, language: 'ar' | 'en'): Promise<void> {
    const blob = await this.getPdfBlob(id, language);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `invoice-${id}-${language}.pdf`;
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
