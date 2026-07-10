// import * as cdk from 'aws-cdk-lib';
// import { Template, Match } from 'aws-cdk-lib/assertions';
// import * as LambdaCrudl from '../lib/lambda-crudl-stack';

// test('SQS Queue and SNS Topic Created', () => {
//   const app = new cdk.App();
//   // WHEN
//   const stack = new LambdaCrudl.LambdaCrudlStack(app, 'MyTestStack');
//   // THEN

//   const template = Template.fromStack(stack);

//   template.hasResourceProperties('AWS::SQS::Queue', {
//     VisibilityTimeout: 300
//   });
//   template.resourceCountIs('AWS::SNS::Topic', 1);
// });
