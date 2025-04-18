// import { Stack, StackProps } from 'aws-cdk-lib';
// import { Construct } from 'constructs';
// import * as lambda from 'aws-cdk-lib/aws-lambda';
// import * as apigateway from 'aws-cdk-lib/aws-apigateway';
// import * as path from 'path';

// export class LambdaCrudlStack extends Stack {
//   constructor(scope: Construct, id: string, props?: StackProps) {
//     super(scope, id, props);

//     const crudLambda = new lambda.Function(this, 'CrudLambda', {
//       runtime: lambda.Runtime.NODEJS_18_X,
//       handler: 'handler.main',
//       code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
//     });

//     const api = new apigateway.RestApi(this, 'CrudApi', {
//       restApiName: 'Simple CRUD API',
//     });

//     const items = api.root.addResource('items');
//     const item = items.addResource('{id}');

//     items.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
//     items.addMethod('POST', new apigateway.LambdaIntegration(crudLambda));

//     item.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
//     item.addMethod('PUT', new apigateway.LambdaIntegration(crudLambda));
//     item.addMethod('DELETE', new apigateway.LambdaIntegration(crudLambda));
//   }
// }

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class LambdaCrudlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const crudLambda = new lambda.Function(this, 'CrudLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.main',
      code: lambda.Code.fromInline(`
        let items = {};

        exports.main = async function(event) {
          const { httpMethod, pathParameters, body } = event;
          const id = pathParameters?.id;

          function respond(statusCode, body) {
            return {
              statusCode,
              headers: { 'Content-Type': 'application/json' },
              body: body ? JSON.stringify(body) : ''
            };
          }

          switch (httpMethod) {
            case 'GET':
              if (id) {
                return respond(items[id] ? 200 : 404, items[id] || { error: 'Not found' });
              }
              return respond(200, Object.values(items));

            case 'POST':
              const data = JSON.parse(body);
              const newId = Date.now().toString();
              items[newId] = { id: newId, ...data };
              return respond(201, items[newId]);

            case 'PUT':
              if (!id || !items[id]) return respond(404, { error: 'Item not found' });
              const update = JSON.parse(body);
              items[id] = { id, ...update };
              return respond(200, items[id]);

            case 'DELETE':
              if (!id || !items[id]) return respond(404, { error: 'Item not found' });
              delete items[id];
              return respond(204, null);

            default:
              return respond(405, { error: 'Method not allowed' });
          }
        };
      `),
    });

    const api = new apigateway.RestApi(this, 'CrudApi', {
      restApiName: 'CRUDL Service',
    });

    const items = api.root.addResource('items');
    items.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
    items.addMethod('POST', new apigateway.LambdaIntegration(crudLambda));

    const item = items.addResource('{id}');
    item.addMethod('GET', new apigateway.LambdaIntegration(crudLambda));
    item.addMethod('PUT', new apigateway.LambdaIntegration(crudLambda));
    item.addMethod('DELETE', new apigateway.LambdaIntegration(crudLambda));

    new cdk.CfnOutput(this, 'CrudApiEndpoint', {
      value: api.url,
    });
  }
}

