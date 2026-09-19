import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { parseApiError } from './api-error';

export interface Appointment {
  id: string;
  patientId: string;
  scheduledAt: string;
  status: 'BOOKED' | 'CONFIRMED' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdById?: string;
  patient: {
    id: string;
    civilId: string;
    fullNameAr: string;
    fullNameEn?: string;
    phone?: string;
  };
}

export interface CreateAppointmentDto {
  patientId: string;
  scheduledAt: string;
  notes?: string;
}

export interface UpdateAppointmentDto {
  patientId?: string;
  scheduledAt?: string;
  notes?: string;
}

export interface UpdateStatusDto {
  status: 'BOOKED' | 'CONFIRMED' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
}

export interface CancelAppointmentDto {
  reason?: string;
}

export interface AppointmentsListResponse {
  data: Appointment[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

class AppointmentsService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getAppointments(
    date?: string,
    status?: string,
    patientId?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<AppointmentsListResponse> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (status) params.append('status', status);
    if (patientId) params.append('patientId', patientId);
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const response = await fetch(
      `${apiBaseUrl}/appointments?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch appointments');
    }

    return response.json();
  }

  async getAppointment(id: string): Promise<Appointment> {
    const response = await fetch(`${apiBaseUrl}/appointments/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch appointment');
    }

    return response.json();
  }

  async createAppointment(data: CreateAppointmentDto): Promise<Appointment> {
    const response = await fetch(`${apiBaseUrl}/appointments`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to create appointment');
    }

    return response.json();
  }

  async updateAppointment(id: string, data: UpdateAppointmentDto): Promise<Appointment> {
    const response = await fetch(`${apiBaseUrl}/appointments/${id}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update appointment');
    }

    return response.json();
  }

  async updateStatus(id: string, data: UpdateStatusDto): Promise<Appointment> {
    const response = await fetch(`${apiBaseUrl}/appointments/${id}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update appointment status');
    }

    return response.json();
  }

  async cancelAppointment(id: string, data: CancelAppointmentDto): Promise<Appointment> {
    const response = await fetch(`${apiBaseUrl}/appointments/${id}/cancel`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to cancel appointment');
    }

    return response.json();
  }

  async deleteAppointmentPermanently(id: string): Promise<{ id: string; deleted: boolean }> {
    const response = await fetch(`${apiBaseUrl}/appointments/${id}/permanent`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, 'Failed to permanently delete appointment');
    }
    return response.json();
  }
}

export const appointmentsService = new AppointmentsService();
