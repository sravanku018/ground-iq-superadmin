/**
 * Server-side job queue — long-tail work leaves the request path.
 *
 * Runs inside the API process on the VPS (no extra infrastructure): a single
 * interval worker claims rows with FOR UPDATE SKIP LOCKED, runs the handler,
 * and retries with backoff. Jobs are durable in Postgres, so a restart picks
 * them up again.
 */
import {
  sql,
} from "./db.ts";
import {
  autoConfirmIfComplete,
} from "./facts.ts";
import {
  deleteSonioxFile,
  pollSonioxTranscription,
} from "../../../lib/soniox.ts";
import { runRetentionSweep } from "./retention.ts";

export type JobKind = "verify_submission" | "transcribe_poll";

export type Job = {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
};

const MAX_ATTEMPTS = 12;
const TICK_MS = 8_000;
/** A claimed job must finish (or requeue) inside this window, or it is reclaimed. */
const LEASE_MS = 5 * 60_000;

/** Backoff for retries: 20s, 40s, 80s … capped at 10 min. */
function backoffMs(attempts: number): number {
  return Math.min(20_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

/** Enqueue a job. Safe to call from route handlers; never throws. */
export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown>,
  delayMs = 0,
): Promise<number | null> {
  try {
    const runAfter = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
    const rows = await sql`
        INSERT INTO jobs (kind, payload, run_after)
        VALUES (${kind}, ${JSON.stringify(payload)}::jsonb, ${runAfter})
        RETURNING id
      `;
    return Number((rows[0] as { id?: number })?.id) || null;
  } catch {
    return null;
  }
}

/** Claim up to `limit` due jobs atomically. */
async function claimJobs(limit = 5): Promise<Job[]> {
  try {
    const rows = await sql`
        UPDATE jobs SET status = 'running', locked_at = NOW(), updated_at = NOW()
        WHERE id IN (
          SELECT id FROM jobs
          WHERE status = 'pending' AND run_after <= NOW()
          ORDER BY id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, payload, attempts
      `;
    return rows as Job[];
  } catch {
    return [];
  }
}

async function completeJob(id: number): Promise<void> {
  await sql`
      UPDATE jobs SET status = 'done', last_error = NULL, locked_at = NULL, updated_at = NOW()
      WHERE id = ${id}
    `.catch(() => null);
}

async function failJob(id: number, attempts: number, error: string): Promise<void> {
  const next = attempts + 1;
  if (next >= MAX_ATTEMPTS) {
    await sql`
        UPDATE jobs
        SET status = 'failed', attempts = ${next}, locked_at = NULL,
            last_error = ${error.slice(0, 500)}, updated_at = NOW()
        WHERE id = ${id}
      `.catch(() => null);
    return;
  }
  const runAfter = new Date(Date.now() + backoffMs(next)).toISOString();
  await sql`
      UPDATE jobs
      SET status = 'pending', attempts = ${next}, locked_at = NULL,
          last_error = ${error.slice(0, 500)},
          run_after = ${runAfter}, updated_at = NOW()
      WHERE id = ${id}
    `.catch(() => null);
}

/**
 * Reclaim jobs whose worker died mid-run. Attempts are incremented so a job
 * that crashes the process every time eventually lands in `failed` instead of
 * looping forever. Runs on every worker tick; cheap (indexed by status).
 */
async function reclaimExpiredJobs(): Promise<void> {
  await sql`
      UPDATE jobs
      SET status = 'failed', attempts = attempts + 1, locked_at = NULL,
          last_error = 'lease expired', updated_at = NOW()
      WHERE status = 'running'
        AND locked_at IS NOT NULL
        AND locked_at < NOW() - INTERVAL '5 minutes'
        AND attempts + 1 >= ${MAX_ATTEMPTS}
    `.catch(() => null);
  await sql`
      UPDATE jobs
      SET status = 'pending', attempts = attempts + 1, locked_at = NULL,
          last_error = 'lease expired', run_after = NOW(), updated_at = NOW()
      WHERE status = 'running'
        AND locked_at IS NOT NULL
        AND locked_at < NOW() - INTERVAL '5 minutes'
    `.catch(() => null);
}

/**
 * On boot every `running` row belongs to a worker that is no longer alive
 * (single API instance per DB — see push_vps.py). Requeue it and count the
 * attempt, so a poison job exhausts MAX_ATTEMPTS instead of being retried
 * forever.
 */
async function resetRunningOnBoot(): Promise<void> {
  await sql`
      UPDATE jobs
      SET status = 'failed', attempts = attempts + 1, locked_at = NULL,
          last_error = 'worker restarted', updated_at = NOW()
      WHERE status = 'running' AND attempts + 1 >= ${MAX_ATTEMPTS}
    `.catch(() => null);
  await sql`
      UPDATE jobs
      SET status = 'pending', attempts = attempts + 1, locked_at = NULL,
          last_error = 'worker restarted', run_after = NOW(), updated_at = NOW()
      WHERE status = 'running'
    `.catch(() => null);
}

class RetryLater extends Error {}

async function runVerify(job: Job): Promise<void> {
  const submissionId = Number(job.payload?.submission_id);
  if (!Number.isFinite(submissionId) || submissionId <= 0) return;
  await autoConfirmIfComplete(sql, submissionId);
}

async function runTranscribePoll(job: Job): Promise<void> {
  const id = Number(job.payload?.conversation_id);
  if (!Number.isFinite(id) || id <= 0) return;
  const rows = await sql`
      SELECT id, soniox_transcription_id, soniox_file_id, transcript_status
      FROM conversations WHERE id = ${id} LIMIT 1
    `.catch(() => []);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return;
  if (String(row.transcript_status || "") === "completed") return;
  const transcriptionId = String(row.soniox_transcription_id || "");
  if (!transcriptionId) return;

  const result = await pollSonioxTranscription(transcriptionId);
  if (result.status === "completed") {
    await sql`
        UPDATE conversations
        SET transcript = ${result.transcript || ""},
            transcript_original = ${result.transcriptOriginal || ""},
            transcript_status = 'completed',
            transcript_error = NULL,
            updated_at = NOW()
        WHERE id = ${id}
      `;
    void deleteSonioxFile(String(row.soniox_file_id || ""));
    return;
  }
  if (result.status === "error") {
    await sql`
        UPDATE conversations
        SET transcript_status = 'error',
            transcript_error = ${result.error || "Transcription failed"},
            updated_at = NOW()
        WHERE id = ${id}
      `;
    void deleteSonioxFile(String(row.soniox_file_id || ""));
    return;
  }
  // Still processing: come back later without burning an attempt.
  throw new RetryLater("still processing");
}

async function runJob(job: Job): Promise<void> {
  if (job.kind === "verify_submission") return runVerify(job);
  if (job.kind === "transcribe_poll") return runTranscribePoll(job);
}

let timer: number | undefined;

/** Start the in-process worker (idempotent). Call once from the entry point. */
export function startJobWorker(): void {
  if (timer !== undefined) return;
  if ((Deno.env.get("JOB_WORKER_DISABLED") || "") === "1") return;
  // Wait for the boot reset before the first claim, otherwise this worker can
  // race the rows it is supposed to recover.
  const boot = resetRunningOnBoot();
  const tick = async () => {
    await boot;
    await reclaimExpiredJobs();
    await runRetentionSweep();
    const jobs = await claimJobs(5);
    for (const job of jobs) {
      try {
        await runJob(job);
        await completeJob(job.id);
      } catch (e) {
        if (e instanceof RetryLater) {
          // Requeue without counting an attempt.
          await sql`
              UPDATE jobs
              SET status = 'pending', locked_at = NULL,
                  run_after = ${new Date(Date.now() + 20_000).toISOString()},
                  last_error = ${(e as Error).message}, updated_at = NOW()
              WHERE id = ${job.id}
            `.catch(() => null);
        } else {
          console.error(JSON.stringify({ level: "error", job: job.kind, id: job.id, err: (e as Error)?.message }));
          await failJob(job.id, job.attempts, String((e as Error)?.message || e));
        }
      }
    }
  };
  timer = setInterval(() => void tick(), TICK_MS) as unknown as number;
  // First pass shortly after boot.
  setTimeout(() => void tick(), 3_000);
}
