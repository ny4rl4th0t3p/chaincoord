import { readFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { PID_FILE, DB_PATH, AUDIT_LOG_PATH } from './global-setup';
import { tmpdir } from 'os';
import { join } from 'path';

const GENESIS_PATH = join(tmpdir(), 'playwright-coordd-genesis');

export default function globalTeardown(): void {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    unlinkSync(PID_FILE);
  }
  for (const f of [DB_PATH, AUDIT_LOG_PATH]) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
  }
  try { if (existsSync(GENESIS_PATH)) rmSync(GENESIS_PATH, { recursive: true }); } catch { /* ignore */ }
}
