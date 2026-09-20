import { loadConfig, log } from './config';
import { Model } from './bedrock';
import { Sessions } from './sessions';
import { createSlackApp } from './slack';
import { startAlertPoller } from './alerts';

async function main(): Promise<void> {
  const config = await loadConfig();
  log('gateway.starting', { model: config.modelId, region: config.region });

  const model = new Model(config);
  const sessions = new Sessions(config);
  const app = createSlackApp(config, model, sessions);

  await app.start();
  log('gateway.started', { mode: 'socket', alertChannel: config.secrets.slackAlertChannel || null });

  const stopAlerts = startAlertPoller(config, model, app.client);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log('gateway.stopping', { signal });
      stopAlerts();
      app.stop().finally(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  log('gateway.fatal', { error: error?.message });
  console.error(error);
  process.exit(1);
});
