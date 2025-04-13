import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as HtmlNginx from '../lib/html-nginx-stack';

test('Stack creates snapshot', () => {
  const app = new cdk.App();
  const stack = new HtmlNginx.HtmlNginxStack(app, 'SnapshotHtmlNginxStack');
  const template = Template.fromStack(stack);
  
  // Convert the template to a JSON string and match it to a stored snapshot
  expect(JSON.stringify(template.toJSON(), null, 2)).toMatchSnapshot();
}); 