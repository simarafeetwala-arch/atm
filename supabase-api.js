/**
 * Supabase API Client for ATM & Banking Operations
 * Connects directly to Supabase PostgREST endpoints using publishable key.
 */

const SUPABASE_CONFIG = {
  url: 'https://ndgdgkusjgitpimkkizh.supabase.co',
  publishableKey: 'sb_publishable__HFoAL1tucIsSpzxLyRxdA_XZzE2Tvz',
  anonJwtKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kZ2Rna3VzamdpdHBpbWtraXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjA1MzYsImV4cCI6MjEwNzI5NjUzNn0.rWGAF8ba7DRjb1LNRh6dNnmMx6oxcKxEXDVrclrc7sc'
};

class SupabaseService {
  constructor() {
    this.url = SUPABASE_CONFIG.url;
    this.key = SUPABASE_CONFIG.publishableKey;
    this.backupKey = SUPABASE_CONFIG.anonJwtKey;
  }

  /**
   * Internal helper for executing Supabase REST requests
   */
  async request(endpoint, options = {}) {
    const defaultHeaders = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    };

    try {
      const response = await fetch(`${this.url}/rest/v1/${endpoint}`, config);

      if (!response.ok) {
        // If 401 Unauthorized with publishable key, try backup anon JWT key
        if (response.status === 401 && this.key !== this.backupKey) {
          console.warn('Switching to backup anon JWT token...');
          this.key = this.backupKey;
          config.headers['apikey'] = this.backupKey;
          config.headers['Authorization'] = `Bearer ${this.backupKey}`;
          const retryRes = await fetch(`${this.url}/rest/v1/${endpoint}`, config);
          if (!retryRes.ok) {
            const errBody = await retryRes.text();
            throw new Error(`API Error [${retryRes.status}]: ${errBody || retryRes.statusText}`);
          }
          return retryRes.status === 204 ? [] : await retryRes.json();
        }

        const errText = await response.text();
        throw new Error(`API Error [${response.status}]: ${errText || response.statusText}`);
      }

      if (response.status === 204) {
        return [];
      }

      return await response.json();
    } catch (err) {
      console.error(`Supabase request failed on ${endpoint}:`, err);
      throw err;
    }
  }

  /**
   * Test connection and latency
   */
  async ping() {
    const t0 = performance.now();
    await this.request('User?select=id&limit=1');
    const t1 = performance.now();
    return Math.round(t1 - t0);
  }

  // ================= USERS =================

  /**
   * Fetch all users ordered by creation date descending
   */
  async getUsers() {
    return await this.request('User?select=*&order=created_at.desc');
  }

  /**
   * Get single user by ID
   */
  async getUserById(id) {
    const users = await this.request(`User?id=eq.${id}&select=*`);
    return users.length ? users[0] : null;
  }

  /**
   * Create a new user account
   */
  async createUser({ user_name, account_number, location }) {
    if (!user_name || !user_name.trim()) {
      throw new Error('User name is required.');
    }
    if (!account_number) {
      throw new Error('Account number is required.');
    }

    const payload = {
      user_name: user_name.trim(),
      account_number: Number(account_number),
      location: location && location.trim() ? location.trim() : null
    };

    const res = await this.request('User', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return Array.isArray(res) ? res[0] : res;
  }

  /**
   * Update an existing user
   */
  async updateUser(id, updates) {
    const payload = {};
    if (updates.user_name !== undefined) payload.user_name = updates.user_name;
    if (updates.account_number !== undefined) payload.account_number = Number(updates.account_number);
    if (updates.location !== undefined) payload.location = updates.location;

    const res = await this.request(`User?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    return Array.isArray(res) ? res[0] : res;
  }

  /**
   * Delete a user (and note their transactions will cascade or need deletion)
   */
  async deleteUser(id) {
    // Delete associated transactions first to prevent foreign key constraint violations
    await this.request(`ATM?user_id=eq.${id}`, {
      method: 'DELETE'
    });

    return await this.request(`User?id=eq.${id}`, {
      method: 'DELETE'
    });
  }

  // ================= ATM TRANSACTIONS =================

  /**
   * Fetch all ATM transactions with optional user filter and ordering
   */
  async getTransactions(options = {}) {
    let query = 'ATM?select=*&order=created_at.desc';
    if (options.userId) {
      query += `&user_id=eq.${options.userId}`;
    }
    if (options.limit) {
      query += `&limit=${options.limit}`;
    }
    return await this.request(query);
  }

  /**
   * Record a new ATM transaction
   * @param {Object} tx - { user_id, type, amount, location }
   */
  async createTransaction({ user_id, type, amount, location }) {
    if (!user_id) throw new Error('User ID is required for ATM transaction.');
    if (!type) throw new Error('Transaction type is required.');
    if (amount === undefined || amount === null || Number(amount) <= 0) {
      throw new Error('Valid transaction amount greater than 0 is required.');
    }

    const payload = {
      user_id: Number(user_id),
      type: type.toLowerCase(),
      amount: Math.round(Number(amount)),
      location: location && location.trim() ? location.trim() : 'ATM Terminal #01'
    };

    const res = await this.request('ATM', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return Array.isArray(res) ? res[0] : res;
  }

  /**
   * Delete an ATM transaction log
   */
  async deleteTransaction(logId) {
    return await this.request(`ATM?log_id=eq.${logId}`, {
      method: 'DELETE'
    });
  }
}

// Export singleton instance
window.supabaseService = new SupabaseService();
