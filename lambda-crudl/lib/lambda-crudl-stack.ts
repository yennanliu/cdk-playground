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
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
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

