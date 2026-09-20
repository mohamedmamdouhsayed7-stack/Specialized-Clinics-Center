import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';

export type AppUserRole = 'ADMIN' | 'RECEPTIONIST';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  role: AppUserRole;
}

export interface UpdateUserDto {
  name: string;
  email: string;
  role: AppUserRole;
}

class UsersService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async getUsers(): Promise<AppUser[]> {
    const response = await fetch(`${apiBaseUrl}/users`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch users');
    return response.json();
  }

  async createUser(data: CreateUserDto): Promise<AppUser> {
    const response = await fetch(`${apiBaseUrl}/users`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to create user');
    }
    return response.json();
  }

  async updateUserStatus(id: string, isActive: boolean): Promise<AppUser> {
    const response = await fetch(`${apiBaseUrl}/users/${id}/status`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ isActive }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update user status');
    }
    return response.json();
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<AppUser> {
    const response = await fetch(`${apiBaseUrl}/users/${id}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update user');
    }
    return response.json();
  }
}

export const usersService = new UsersService();
