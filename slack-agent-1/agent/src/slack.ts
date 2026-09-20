import { App, LogLevel } from '@slack/bolt';
import type { Config } from './config';
import { log } from './config';
import { Model } from './bedrock';
import { Sessions } from './sessions';

/**
 * The Slack surface.
 *
 * Socket Mode means Bolt holds an outbound WebSocket and acknowledges events
 * for us inside Slack's 3-second window; the handler body then runs
 * asynchronously. We post a placeholder immediately and edit it as the answer
 * develops, so a long tool loop still looks alive.
 */
export function createSlackApp(config: Config, model: Model, sessions: Sessions) {
  const app = new App({
    token: config.secrets.slackBotToken,
    appToken: config.secrets.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Slack redelivers events it thinks we missed. Answering twice would mean
  // running the tools twice, so remember what we have already seen.
  const handled = new Set<string>();

  async function answer(args: {
    text: string;
    channel: string;
    thread: string;
    eventId: string;
    say: any;
    client: any;
  }) {
    const { text, channel, thread, eventId, client } = args;
    if (!text.trim()) return;
    if (handled.has(eventId)) {
      log('slack.duplicate_ignored', { eventId });
      return;
    }
    handled.add(eventId);
    if (handled.size > 1000) handled.clear();

    const pk = Sessions.key(channel, thread);
    const started = Date.now();
    log('slack.request', { thread: pk, chars: text.length });

    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: thread,
      text: '_thinking…_',
    });
    const update = (body: string) =>
      client.chat.update({ channel, ts: placeholder.ts, text: body }).catch(() => {});

    try {
      const history = await sessions.history(pk);
      history.push({ role: 'user', content: text });

      const { text: reply, turns } = await model.respond(history, async (note) =>
        update(`_${note}_`),
      );

      await sessions.save(pk, turns);
      await update(reply);
      log('slack.answered', { thread: pk, ms: Date.now() - started });
    } catch (error: any) {
      log('slack.failed', { thread: pk, error: error?.name, message: error?.message });
      await update(
        `:warning: ${error?.name ?? 'Error'}: ${error?.message ?? 'something went wrong'}`,
      );
    }
  }

  app.event('app_mention', async ({ event, say, client }: any) => {
    const e = event as any;
    await answer({
      // Strip the leading <@Uxxxx> mention so the model sees the question only.
      text: String(e.text ?? '').replace(/<@[^>]+>\s*/g, ''),
      channel: e.channel,
      thread: e.thread_ts ?? e.ts,
      eventId: e.client_msg_id ?? `${e.channel}:${e.ts}`,
      say,
      client,
    });
  });

  app.message(async ({ message, say, client }: any) => {
    const m = message as any;
    // Direct messages only; in channels the agent waits to be mentioned so it
    // does not answer every line of an unrelated conversation.
    if (m.channel_type !== 'im' || m.subtype || m.bot_id) return;
    await answer({
      text: String(m.text ?? ''),
      channel: m.channel,
      thread: m.thread_ts ?? m.ts,
      eventId: m.client_msg_id ?? `${m.channel}:${m.ts}`,
      say,
      client,
    });
  });

  return app;
}
