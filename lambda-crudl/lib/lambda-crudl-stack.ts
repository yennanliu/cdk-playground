import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class LambdaCrudlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const crudLambda = new lambda.Function(this, 'CrudLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.main',

      /** NOTE !!! 
       *  
       * AWS CDK expects `lambda code` written in javascript (instead of typescript)
       * so we need to compile the typescript code to javascript first
       * then we are able to refer to the compiled javascript code
       * as below
       * 
       *  1) add `lambda-crudl/tsconfig.lambda.json` 
       *  2) compile the typescript code to javascript : npx tsc -p tsconfig.lambda.json
       *  3) cdk deploy
       */
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda')),
    });

    const api = new apigateway.RestApi(this, 'CrudApi', {
      restApiName: 'Simple CRUD API',
    });

    const items = api.root.addResource('items');
    const item = items.addResource('{id}');

    items.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
    items.addMethod('POST', new apigateway.LambdaIntegration(crudLambda));

    item.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
    item.addMethod('PUT', new apigateway.LambdaIntegration(crudLambda));
    item.addMethod('DELETE', new apigateway.LambdaIntegration(crudLambda));
  }
}