import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { ApiError, parseApiError } from './api-error';

export interface Patient {
  id: string;
  civilId: string | null;
  fullNameAr: string;
  fullNameEn?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  createdById?: string;
  legacySource?: string | null;
  legacyPatientKey?: string | null;
  legacyReference?: string | null;
  lastVisitDate?: string | null;
  nextAppointmentDate?: string | null;
}

export interface CreatePatientDto {
  civilId: string;
  fullNameAr: string;
  fullNameEn?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
}

export interface UpdatePatientDto {
  civilId?: string;
  fullNameAr?: string;
  fullNameEn?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
}

export interface PatientsListResponse {
  data: Patient[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

class PatientsService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getPatients(
    search?: string,
    isArchived?: boolean,
    page: number = 1,
    limit: number = 20
  ): Promise<PatientsListResponse> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (isArchived !== undefined) params.append('isArchived', isArchived.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const response = await fetch(
      `${apiBaseUrl}/patients?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch patients');
    }

    return response.json();
  }

  async getPatient(id: string): Promise<Patient> {
    const response = await fetch(`${apiBaseUrl}/patients/${id}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to fetch patient');
    }

    return response.json();
  }

  async createPatient(data: CreatePatientDto): Promise<Patient> {
    const response = await fetch(`${apiBaseUrl}/patients`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to create patient');
    }

    return response.json();
  }

  async updatePatient(id: string, data: UpdatePatientDto): Promise<Patient> {
    const response = await fetch(`${apiBaseUrl}/patients/${id}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to update patient');
    }

    return response.json();
  }

  async archivePatient(id: string): Promise<Patient> {
    const response = await fetch(`${apiBaseUrl}/patients/${id}/archive`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to archive patient');
    }

    return response.json();
  }

  async restorePatient(id: string): Promise<Patient> {
    const response = await fetch(`${apiBaseUrl}/patients/${id}/restore`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw await parseApiError(response, 'Failed to restore patient');
    }

    return response.json();
  }

  async deletePatientPermanently(id: string): Promise<{ id: string; deleted: boolean }> {
    const response = await fetch(`${apiBaseUrl}/patients/${id}/permanent`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, 'Failed to permanently delete patient');
    }
    return response.json();
  }
}

export const patientsService = new PatientsService();
