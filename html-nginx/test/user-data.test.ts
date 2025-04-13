import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as HtmlNginx from '../lib/html-nginx-stack';

describe('User Data Tests', () => {
  let app: cdk.App;
  let stack: HtmlNginx.HtmlNginxStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new HtmlNginx.HtmlNginxStack(app, 'UserDataTestStack');
    template = Template.fromStack(stack);
  });

  test('UserData contains required installation commands', () => {
    // Check for the Launch Configuration with proper UserData
    template.hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
      UserData: {
        'Fn::Base64': Match.anyValue()
      },
      InstanceType: 't2.micro'
    });
    
    // Get the template as JSON to inspect the UserData
    const templateJson = template.toJSON();
    
    // Find all AutoScaling LaunchConfigurations
    const launchConfigs = Object.entries(templateJson.Resources)
      .filter(([_, resource]) => 
        (resource as any).Type === 'AWS::AutoScaling::LaunchConfiguration');
    
    // Get UserData from the first LaunchConfiguration
    if (launchConfigs.length > 0) {
      const userDataBase64 = (launchConfigs[0][1] as any).Properties.UserData['Fn::Base64'];
      
      // If UserData is constructed with Fn::Join
      if (userDataBase64['Fn::Join']) {
        const joinParts = userDataBase64['Fn::Join'][1];
        const userDataString = joinParts.join('');
        
        // Check for required commands
        expect(userDataString).toContain('amazon-linux-extras install nginx1 -y');
        expect(userDataString).toContain('mkdir -p /var/www/html');
        expect(userDataString).toContain('systemctl start nginx');
      }
    }
  });
}); 