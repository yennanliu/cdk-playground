import { loadConfig, log } from './config';
import { Model } from './bedrock';

/**
 * Send one request to the agent from the command line.
 *
 *   node dist/ask.js "how many CPUs does the sandbox have?"
 *
 * Same model, same system prompt, same sandbox tool as a Slack message takes --
 * only the transport differs. That makes it the fastest way to exercise the
 * agent, and it works before any Slack app exists.
 *
 * Progress goes to stderr and the answer to stdout, so callers can capture just
 * the answer with `2>/dev/null`.
 */
async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) {
    console.error('usage: node dist/ask.js "<your question>"');
    process.exit(2);
  }

  const config = await loadConfig({ requireSlack: false });
  const model = new Model(config);

  const { text } = await model.respond([{ role: 'user', content: prompt }], async (note) => {
    process.stderr.write(`... ${note}\n`);
  });

  console.log(text);
}

main().catch((error) => {
  log('ask.failed', { error: error?.name, message: error?.message });
  console.error(`${error?.name ?? 'Error'}: ${error?.message ?? error}`);
  process.exit(1);
});
