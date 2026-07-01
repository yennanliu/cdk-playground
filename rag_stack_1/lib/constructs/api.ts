import { RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HttpApi, CorsHttpMethod, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { appFunction } from './fn';

export interface ApiProps {
  docsBucket: s3.IBucket;
  knowledgeBaseId: string;
  knowledgeBaseArn: string;
  modelArn: string;
  /** Shared password for the prototype login. */
  appPassword: string;
}

// HTTP API with a shared-password gate:
//  POST /login       -> mint token (open)
//  POST /upload-url  -> presigned PUT (token required)
//  POST /query       -> RAG answer   (token required)
export class Api extends Construct {
  readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // One secret holds the (injected) password + an auto-generated HMAC signing key.
    const secret = new sm.Secret(this, 'AppSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ password: props.appPassword }),
        generateStringKey: 'signingKey',
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const login = appFunction(this, 'LoginFn', 'login.ts', { SECRET_ARN: secret.secretArn });
    const authorizerFn = appFunction(this, 'AuthorizerFn', 'authorizer.ts', { SECRET_ARN: secret.secretArn });
    const uploadUrl = appFunction(this, 'UploadUrlFn', 'upload-url.ts', { DOCS_BUCKET: props.docsBucket.bucketName });
    const query = appFunction(this, 'QueryFn', 'query.ts', {
      KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
      MODEL_ARN: props.modelArn,
    });

    secret.grantRead(login);
    secret.grantRead(authorizerFn);
    props.docsBucket.grantPut(uploadUrl);

    // RetrieveAndGenerate retrieves from the KB and invokes the generation model
    // under the caller's identity.
    query.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
      resources: [props.knowledgeBaseArn],
    }));
    query.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [props.modelArn],
    }));

    const authorizer = new HttpLambdaAuthorizer('Authorizer', authorizerFn, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      identitySource: ['$request.header.Authorization'],
      resultsCacheTtl: Duration.seconds(0),
    });

    this.httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'], // dev/internal; tighten to the site origin later
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type'],
      },
    });

    this.httpApi.addRoutes({
      path: '/login',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('LoginInt', login),
    });
    this.httpApi.addRoutes({
      path: '/upload-url',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('UploadInt', uploadUrl),
      authorizer,
    });
    this.httpApi.addRoutes({
      path: '/query',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('QueryInt', query),
      authorizer,
    });

    new CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new CfnOutput(this, 'AppSecretArn', {
      value: secret.secretArn,
      description: 'Read the login password from this secret (Secrets Manager)',
    });
  }
}
