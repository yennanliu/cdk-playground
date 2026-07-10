import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OpenSearchDomainStack } from '../lib/opensearch-domain-stack';
import { EngineVersion } from 'aws-cdk-lib/aws-opensearchservice';

test('OpenSearch Domain Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new OpenSearchDomainStack(app, 'MyTestStack', {
    version: EngineVersion.OPENSEARCH_2_5,
    domainName: 'test-domain',
    stage: 'test'
  });
  // THEN

  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::OpenSearchService::Domain', 1);
  template.resourceCountIs('AWS::IAM::Role', 4); // LoggingRoles creates 2 roles + 2 Lambda roles
});
