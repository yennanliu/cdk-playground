import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class CrudlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Define the Lambda function
    const crudlLambda = new lambda.Function(this, 'CrudlLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'crudl.handler',
    });

    // Define the API Gateway
    const api = new apigateway.RestApi(this, 'CrudlApi', {
      restApiName: 'CRUDL Service',
      description: 'This service handles CRUDL operations.',
    });

    // Define API resources and methods
    const items = api.root.addResource('items');
    items.addMethod('GET', new apigateway.LambdaIntegration(crudlLambda)); // List items
    items.addMethod('POST', new apigateway.LambdaIntegration(crudlLambda)); // Create item

    const singleItem = items.addResource('{id}');
    singleItem.addMethod('GET', new apigateway.LambdaIntegration(crudlLambda)); // Read item
    singleItem.addMethod('PUT', new apigateway.LambdaIntegration(crudlLambda)); // Update item
    singleItem.addMethod('DELETE', new apigateway.LambdaIntegration(crudlLambda)); // Delete item
  }
}
