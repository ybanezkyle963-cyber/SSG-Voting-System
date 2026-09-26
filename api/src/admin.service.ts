import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { instantRunoff, approval } from './tally';

/**
 * The gate behind the committee dashboard.
 *
 * Accepts a fixed entry code, set from the ADMIN_GATE_CODE environment
 * variable. On Vercel this is provisioned as a deployment variable; locally it
 * defaults to SSG-2026 for development.
 */

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  gateCode(): string {
    return process.env.ADMIN_GATE_CODE || 'SSG-2026';
  }

  /** Returns 'ok' when the code matches, 'denied' otherwise. */
  async checkGate(code: string): Promise<'ok' | 'denied'> {
    if (String(code || '').trim() === this.gateCode()) {
      await this.db.audit('admin.gate.opened', {});
      return 'ok';
    }
    await this.db.audit('admin.gate.denied', {});
    return 'denied';
  }
}
