import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

// Small factory for the app's Lambdas — TypeScript handlers bundled with esbuild.
// externalModules: [] bundles the AWS SDK v3 clients so the presigner et al. are
// always present, regardless of what the runtime image happens to ship.
export function appFunction(
  scope: Construct,
  id: string,
  file: string,
  environment: Record<string, string> = {},
): NodejsFunction {
  return new NodejsFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    entry: path.join(__dirname, '..', '..', 'lambda', file),
    handler: 'handler',
    timeout: Duration.seconds(30),
    memorySize: 256,
    environment,
    bundling: { externalModules: [], minify: true },
  });
}
