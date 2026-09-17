import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';

export type PaymentMethod = 'KNET' | 'LINK';

export interface Payment {
  id: string;
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  notes?: string;
  createdAt: string;
  recordedBy?: {
    id: string;
    name: string;
  };
}

export interface CreatePaymentDto {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
}

class PaymentsService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getPaymentsForInvoice(invoiceId: string): Promise<Payment[]> {
    const response = await fetch(`${apiBaseUrl}/payments?invoiceId=${invoiceId}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch payments');
    }

    return response.json();
  }

  async createPayment(data: CreatePaymentDto): Promise<Payment> {
    const response = await fetch(`${apiBaseUrl}/payments`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to record payment');
    }

    return response.json();
  }

  async reversePayment(id: string, reversalNotes?: string): Promise<{ id: string; reversed: boolean }> {
    const response = await fetch(`${apiBaseUrl}/payments/${id}/reverse`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ reversalNotes }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to reverse payment');
    }

    return response.json();
  }
}

export const paymentsService = new PaymentsService();
