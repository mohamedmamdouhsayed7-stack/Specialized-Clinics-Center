import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { parseApiError } from './api-error';

export type VisitStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'VOID';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  total: string;
  paid: string;
  remaining: string;
  paymentStatus: PaymentStatus;
  invoiceItems: Array<{ serviceNameSnapshot: string }>;
}

export function currentInvoice(invoices?: Invoice[]): Invoice | undefined {
  return invoices?.find((invoice) => invoice.status === 'ISSUED')
    ?? invoices?.find((invoice) => invoice.status === 'DRAFT');
}

export interface Visit {
  id: string;
  patientId: string;
  appointmentId?: string;
  type: 'CHECKUP' | 'FOLLOW_UP' | 'OTHER';
  status: VisitStatus;
  visitDate: string;
  notes?: string;
  diagnosis?: string;
  createdAt: string;
  updatedAt: string;
  createdById?: string;
  patient: {
    id: string;
    civilId: string;
    fullNameAr: string;
    phone?: string;
  };
  appointment?: {
    id: string;
    scheduledAt: string;
    status: string;
  };
  createdBy?: {
    id: string;
    name: string;
  };
  invoices?: Invoice[];
}

export interface CreateVisitDto {
  patientId: string;
  type: 'CHECKUP' | 'FOLLOW_UP' | 'OTHER';
  appointmentId?: string;
  visitDate?: string;
  notes?: string;
  diagnosis?: string;
}

export interface UpdateVisitDto {
  type?: 'CHECKUP' | 'FOLLOW_UP' | 'OTHER';
  appointmentId?: string;
  visitDate?: string;
  notes?: string;
  diagnosis?: string;
}

export interface VisitsListResponse {
  data: Visit[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface TodayVisitCounts {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

class VisitsService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getVisits(
    patientId?: string,
    appointmentId?: string,
    type?: string,
    status?: VisitStatus,
    from?: string,
    to?: string,
    search?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<VisitsListResponse> {
    const params = new URLSearchParams();
    if (patientId) params.append('patientId', patientId);
    if (appointmentId) params.append('appointmentId', appointmentId);
    if (type) params.append('type', type);
    if (status) params.append('status', status);
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (search) params.append('search', search);
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const response = await fetch(`${apiBaseUrl}/visits?${params.toString()}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch visits');
    }

    return response.json();
  }

  async getTodayCounts(): Promise<TodayVisitCounts> {
    const response = await fetch(`${apiBaseUrl}/visits/today-counts`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch today visit counts');
    }
    return response.json();
  }

  async getVisit(id: string): Promise<Visit> {
    const response = await fetch(`${apiBaseUrl}/visits/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch visit');
    }

    return response.json();
  }

  async createVisit(data: CreateVisitDto): Promise<Visit> {
    const response = await fetch(`${apiBaseUrl}/visits`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to create visit');
    }

    return response.json();
  }

  async updateVisit(id: string, data: UpdateVisitDto): Promise<Visit> {
    const response = await fetch(`${apiBaseUrl}/visits/${id}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update visit');
    }

    return response.json();
  }

  async deleteVisitPermanently(id: string): Promise<{ id: string; deleted: boolean }> {
    const response = await fetch(`${apiBaseUrl}/visits/${id}/permanent`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, 'Failed to permanently delete visit');
    }
    return response.json();
  }

  async updateVisitStatus(id: string, status: VisitStatus): Promise<Visit> {
    const response = await fetch(`${apiBaseUrl}/visits/${id}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update visit status');
    }

    return response.json();
  }

  async getPatientVisits(patientId: string, page: number = 1, limit: number = 20): Promise<VisitsListResponse> {
    return this.getVisits(patientId, undefined, undefined, undefined, undefined, undefined, undefined, page, limit);
  }
}

export const visitsService = new VisitsService();
