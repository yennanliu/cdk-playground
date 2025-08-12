"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
class NetworkStack extends aws_cdk_lib_1.Stack {
    vpc;
    domainSubnets;
    domainSecurityGroups;
    constructor(scope, id, props) {
        super(scope, id, props);
        // Retrieve existing VPC
        if (props.vpcId) {
            this.vpc = aws_ec2_1.Vpc.fromLookup(this, 'domainVPC', {
                vpcId: props.vpcId,
            });
        }
        // Create new VPC
        else {
            this.vpc = new aws_ec2_1.Vpc(this, 'domainVPC', {
                // IP space should be customized for use cases that have specific IP range needs
                ipAddresses: aws_ec2_1.IpAddresses.cidr('10.0.0.0/16'),
                maxAzs: props.availabilityZoneCount ? props.availabilityZoneCount : 1,
                subnetConfiguration: [
                    // Outbound internet access for private subnets require a NAT Gateway which must live in
                    // a public subnet
                    {
                        name: 'public-subnet',
                        subnetType: aws_ec2_1.SubnetType.PUBLIC,
                        cidrMask: 24,
                    },
                    // Nodes will live in these subnets
                    {
                        name: 'private-subnet',
                        subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS,
                        cidrMask: 24,
                    },
                ],
            });
        }
        // If specified, these subnets will be selected to place the Domain nodes in. Otherwise, this is not provided
        // to the Domain as it has existing behavior to select private subnets from a given VPC
        if (props.vpcSubnetIds) {
            const selectSubnets = this.vpc.selectSubnets({
                subnetFilters: [aws_ec2_1.SubnetFilter.byIds(props.vpcSubnetIds)]
            });
            this.domainSubnets = [selectSubnets];
        }
        // Retrieve existing SGs to apply to VPC Domain endpoints
        if (props.vpcSecurityGroupIds) {
            const securityGroups = [];
            for (let i = 0; i < props.vpcSecurityGroupIds.length; i++) {
                securityGroups.push(aws_ec2_1.SecurityGroup.fromLookupById(this, "domainSecurityGroup-" + i, props.vpcSecurityGroupIds[i]));
            }
            this.domainSecurityGroups = securityGroups;
        }
        // Create a default SG to allow open access to Domain within VPC. This should be further restricted for users
        // who want limited access to their domain within the VPC
        else {
            const defaultSecurityGroup = new aws_ec2_1.SecurityGroup(this, 'domainSecurityGroup', {
                vpc: this.vpc,
                allowAllOutbound: true,
            });
            defaultSecurityGroup.addIngressRule(aws_ec2_1.Peer.ipv4('0.0.0.0/0'), aws_ec2_1.Port.allTcp());
            defaultSecurityGroup.addIngressRule(defaultSecurityGroup, aws_ec2_1.Port.allTraffic());
            this.domainSecurityGroups = [defaultSecurityGroup];
        }
    }
}
exports.NetworkStack = NetworkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmV0d29yay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm5ldHdvcmstc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQThDO0FBQzlDLGlEQVc2QjtBQVc3QixNQUFhLFlBQWEsU0FBUSxtQkFBSztJQUVuQixHQUFHLENBQU87SUFDVixhQUFhLENBQThCO0lBQzNDLG9CQUFvQixDQUFtQjtJQUV2RCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXdCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHdCQUF3QjtRQUN4QixJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNkLElBQUksQ0FBQyxHQUFHLEdBQUcsYUFBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO2dCQUN6QyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7YUFDckIsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUNELGlCQUFpQjthQUNaLENBQUM7WUFDRixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksYUFBRyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7Z0JBQ2xDLGdGQUFnRjtnQkFDaEYsV0FBVyxFQUFFLHFCQUFXLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQztnQkFDNUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNyRSxtQkFBbUIsRUFBRTtvQkFDakIsd0ZBQXdGO29CQUN4RixrQkFBa0I7b0JBQ2xCO3dCQUNJLElBQUksRUFBRSxlQUFlO3dCQUNyQixVQUFVLEVBQUUsb0JBQVUsQ0FBQyxNQUFNO3dCQUM3QixRQUFRLEVBQUUsRUFBRTtxQkFDZjtvQkFDRCxtQ0FBbUM7b0JBQ25DO3dCQUNJLElBQUksRUFBRSxnQkFBZ0I7d0JBQ3RCLFVBQVUsRUFBRSxvQkFBVSxDQUFDLG1CQUFtQjt3QkFDMUMsUUFBUSxFQUFFLEVBQUU7cUJBQ2Y7aUJBQ0o7YUFDSixDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsNkdBQTZHO1FBQzdHLHVGQUF1RjtRQUN2RixJQUFJLEtBQUssQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNyQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztnQkFDekMsYUFBYSxFQUFFLENBQUMsc0JBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQzFELENBQUMsQ0FBQTtZQUNGLElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUN4QyxDQUFDO1FBRUQseURBQXlEO1FBQ3pELElBQUksS0FBSyxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDNUIsTUFBTSxjQUFjLEdBQXFCLEVBQUUsQ0FBQTtZQUMzQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUN4RCxjQUFjLENBQUMsSUFBSSxDQUFDLHVCQUFhLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxzQkFBc0IsR0FBRyxDQUFDLEVBQUUsS0FBSyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNySCxDQUFDO1lBQ0QsSUFBSSxDQUFDLG9CQUFvQixHQUFHLGNBQWMsQ0FBQTtRQUM5QyxDQUFDO1FBQ0QsNkdBQTZHO1FBQzdHLHlEQUF5RDthQUNwRCxDQUFDO1lBQ0YsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLHVCQUFhLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO2dCQUN4RSxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7Z0JBQ2IsZ0JBQWdCLEVBQUUsSUFBSTthQUN6QixDQUFDLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxjQUFjLENBQUMsY0FBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxjQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUMzRSxvQkFBb0IsQ0FBQyxjQUFjLENBQUMsb0JBQW9CLEVBQUUsY0FBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDN0UsSUFBSSxDQUFDLG9CQUFvQixHQUFHLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtRQUN0RCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBcEVELG9DQW9FQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7U3RhY2ssIFN0YWNrUHJvcHN9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHtcbiAgICBJcEFkZHJlc3NlcyxcbiAgICBJU2VjdXJpdHlHcm91cCxcbiAgICBJVnBjLFxuICAgIFBlZXIsXG4gICAgUG9ydCxcbiAgICBTZWN1cml0eUdyb3VwLFxuICAgIFN1Ym5ldEZpbHRlcixcbiAgICBTdWJuZXRTZWxlY3Rpb24sXG4gICAgU3VibmV0VHlwZSxcbiAgICBWcGNcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lYzJcIjtcbmltcG9ydCB7Q29uc3RydWN0fSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHtTdGFja1Byb3BzRXh0fSBmcm9tIFwiLi9zdGFjay1jb21wb3NlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIG5ldHdvcmtTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wc0V4dCB7XG4gICAgcmVhZG9ubHkgdnBjSWQ/OiBzdHJpbmdcbiAgICByZWFkb25seSB2cGNTdWJuZXRJZHM/OiBzdHJpbmdbXVxuICAgIHJlYWRvbmx5IHZwY1NlY3VyaXR5R3JvdXBJZHM/OiBzdHJpbmdbXVxuICAgIHJlYWRvbmx5IGF2YWlsYWJpbGl0eVpvbmVDb3VudD86IG51bWJlclxufVxuXG5leHBvcnQgY2xhc3MgTmV0d29ya1N0YWNrIGV4dGVuZHMgU3RhY2sge1xuXG4gICAgcHVibGljIHJlYWRvbmx5IHZwYzogSVZwYztcbiAgICBwdWJsaWMgcmVhZG9ubHkgZG9tYWluU3VibmV0czogU3VibmV0U2VsZWN0aW9uW118dW5kZWZpbmVkO1xuICAgIHB1YmxpYyByZWFkb25seSBkb21haW5TZWN1cml0eUdyb3VwczogSVNlY3VyaXR5R3JvdXBbXTtcblxuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBuZXR3b3JrU3RhY2tQcm9wcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgICAgICAvLyBSZXRyaWV2ZSBleGlzdGluZyBWUENcbiAgICAgICAgaWYgKHByb3BzLnZwY0lkKSB7XG4gICAgICAgICAgICB0aGlzLnZwYyA9IFZwYy5mcm9tTG9va3VwKHRoaXMsICdkb21haW5WUEMnLCB7XG4gICAgICAgICAgICAgICAgdnBjSWQ6IHByb3BzLnZwY0lkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBWUENcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnZwYyA9IG5ldyBWcGModGhpcywgJ2RvbWFpblZQQycsIHtcbiAgICAgICAgICAgICAgICAvLyBJUCBzcGFjZSBzaG91bGQgYmUgY3VzdG9taXplZCBmb3IgdXNlIGNhc2VzIHRoYXQgaGF2ZSBzcGVjaWZpYyBJUCByYW5nZSBuZWVkc1xuICAgICAgICAgICAgICAgIGlwQWRkcmVzc2VzOiBJcEFkZHJlc3Nlcy5jaWRyKCcxMC4wLjAuMC8xNicpLFxuICAgICAgICAgICAgICAgIG1heEF6czogcHJvcHMuYXZhaWxhYmlsaXR5Wm9uZUNvdW50ID8gcHJvcHMuYXZhaWxhYmlsaXR5Wm9uZUNvdW50IDogMSxcbiAgICAgICAgICAgICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgICAgICAgICAgICAgIC8vIE91dGJvdW5kIGludGVybmV0IGFjY2VzcyBmb3IgcHJpdmF0ZSBzdWJuZXRzIHJlcXVpcmUgYSBOQVQgR2F0ZXdheSB3aGljaCBtdXN0IGxpdmUgaW5cbiAgICAgICAgICAgICAgICAgICAgLy8gYSBwdWJsaWMgc3VibmV0XG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdwdWJsaWMtc3VibmV0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAvLyBOb2RlcyB3aWxsIGxpdmUgaW4gdGhlc2Ugc3VibmV0c1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAncHJpdmF0ZS1zdWJuZXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3VibmV0VHlwZTogU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHNwZWNpZmllZCwgdGhlc2Ugc3VibmV0cyB3aWxsIGJlIHNlbGVjdGVkIHRvIHBsYWNlIHRoZSBEb21haW4gbm9kZXMgaW4uIE90aGVyd2lzZSwgdGhpcyBpcyBub3QgcHJvdmlkZWRcbiAgICAgICAgLy8gdG8gdGhlIERvbWFpbiBhcyBpdCBoYXMgZXhpc3RpbmcgYmVoYXZpb3IgdG8gc2VsZWN0IHByaXZhdGUgc3VibmV0cyBmcm9tIGEgZ2l2ZW4gVlBDXG4gICAgICAgIGlmIChwcm9wcy52cGNTdWJuZXRJZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdFN1Ym5ldHMgPSB0aGlzLnZwYy5zZWxlY3RTdWJuZXRzKHtcbiAgICAgICAgICAgICAgICBzdWJuZXRGaWx0ZXJzOiBbU3VibmV0RmlsdGVyLmJ5SWRzKHByb3BzLnZwY1N1Ym5ldElkcyldXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgdGhpcy5kb21haW5TdWJuZXRzID0gW3NlbGVjdFN1Ym5ldHNdXG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXRyaWV2ZSBleGlzdGluZyBTR3MgdG8gYXBwbHkgdG8gVlBDIERvbWFpbiBlbmRwb2ludHNcbiAgICAgICAgaWYgKHByb3BzLnZwY1NlY3VyaXR5R3JvdXBJZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlY3VyaXR5R3JvdXBzOiBJU2VjdXJpdHlHcm91cFtdID0gW11cbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcHJvcHMudnBjU2VjdXJpdHlHcm91cElkcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHNlY3VyaXR5R3JvdXBzLnB1c2goU2VjdXJpdHlHcm91cC5mcm9tTG9va3VwQnlJZCh0aGlzLCBcImRvbWFpblNlY3VyaXR5R3JvdXAtXCIgKyBpLCBwcm9wcy52cGNTZWN1cml0eUdyb3VwSWRzW2ldKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZG9tYWluU2VjdXJpdHlHcm91cHMgPSBzZWN1cml0eUdyb3Vwc1xuICAgICAgICB9XG4gICAgICAgIC8vIENyZWF0ZSBhIGRlZmF1bHQgU0cgdG8gYWxsb3cgb3BlbiBhY2Nlc3MgdG8gRG9tYWluIHdpdGhpbiBWUEMuIFRoaXMgc2hvdWxkIGJlIGZ1cnRoZXIgcmVzdHJpY3RlZCBmb3IgdXNlcnNcbiAgICAgICAgLy8gd2hvIHdhbnQgbGltaXRlZCBhY2Nlc3MgdG8gdGhlaXIgZG9tYWluIHdpdGhpbiB0aGUgVlBDXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdFNlY3VyaXR5R3JvdXAgPSBuZXcgU2VjdXJpdHlHcm91cCh0aGlzLCAnZG9tYWluU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGRlZmF1bHRTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFBlZXIuaXB2NCgnMC4wLjAuMC8wJyksIFBvcnQuYWxsVGNwKCkpO1xuICAgICAgICAgICAgZGVmYXVsdFNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoZGVmYXVsdFNlY3VyaXR5R3JvdXAsIFBvcnQuYWxsVHJhZmZpYygpKTtcbiAgICAgICAgICAgIHRoaXMuZG9tYWluU2VjdXJpdHlHcm91cHMgPSBbZGVmYXVsdFNlY3VyaXR5R3JvdXBdXG4gICAgICAgIH1cbiAgICB9XG59Il19