import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Config } from './config';
import { log } from './config';

const RUNNER = '/usr/local/bin/slack-agent-run-job';

export interface JobResult {
  ok: boolean;
  output: string;
}

/**
 * Run a command in a throwaway container.
 *
 * Everything the model decides to execute goes through here, and through
 * `slack-agent-run-job` specifically -- never a bare `docker run` and never a
 * shell on the host. The runner owns the isolation flags, the scoped
 * credentials, and the timeout; this function only hands it a command.
 */
export function runJob(config: Config, command: string, env: Record<string, string> = {}): Promise<JobResult> {
  const jobId = randomUUID().slice(0, 8);
  const started = Date.now();

  return new Promise((resolve) => {
    execFile(
      RUNNER,
      [jobId, 'bash', '-lc', command],
      {
        // Belt and braces: the runner enforces the real timeout with `timeout`,
        // this only stops us waiting forever on a wedged child.
        timeout: (config.jobTimeoutSeconds + 60) * 1000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();
        const ok = !error;
        log('job.finished', { jobId, ok, ms: Date.now() - started, bytes: output.length });
        resolve({
          ok,
          output: output.slice(-12000) || (ok ? '(no output)' : `job failed: ${error?.message}`),
        });
      },
    );
  });
}
