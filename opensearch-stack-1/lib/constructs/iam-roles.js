"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggingRoles = exports.CloudWatchLogsRole = exports.FirehoseRole = void 0;
const constructs_1 = require("constructs");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
class FirehoseRole extends constructs_1.Construct {
    role;
    constructor(scope, id, props) {
        super(scope, id);
        this.role = new iam.Role(this, 'Role', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
            description: 'Role for Firehose to access OpenSearch and S3',
        });
        // Add comprehensive OpenSearch permissions
        this.role.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'es:*',
                'opensearch:*'
            ],
            resources: [
                `arn:aws:es:${props.region}:*:domain/*`,
                `arn:aws:opensearch:${props.region}:*:domain/*`
            ]
        }));
        // Add S3 permissions for Firehose backup operations
        this.role.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
                's3:PutObjectAcl'
            ],
            resources: [
                'arn:aws:s3:::firehose-*',
                'arn:aws:s3:::firehose-*/*',
                'arn:aws:s3:::kinesisfirehose*',
                'arn:aws:s3:::kinesisfirehose*/*'
            ]
        }));
        // Add CloudWatch Logs permissions for Firehose operations
        this.role.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [
                `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/kinesisfirehose/*`,
                `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/kinesisfirehose/*:log-stream:*`
            ]
        }));
        // Add Lambda permissions for processing
        this.role.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'lambda:GetFunction',
                'lambda:InvokeFunction'
            ],
            resources: [
                `arn:aws:lambda:${props.region}:${props.account}:function:*`
            ]
        }));
    }
}
exports.FirehoseRole = FirehoseRole;
class CloudWatchLogsRole extends constructs_1.Construct {
    role;
    constructor(scope, id, props) {
        super(scope, id);
        this.role = new iam.Role(this, 'Role', {
            assumedBy: new iam.ServicePrincipal(`logs.${props.region}.amazonaws.com`),
            description: 'Role for CloudWatch Logs to send data to Firehose',
        });
        // Add Firehose permissions
        this.role.addToPolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'firehose:PutRecord',
                'firehose:PutRecordBatch'
            ],
            resources: [
                `arn:aws:firehose:${props.region}:${props.account}:deliverystream/*`
            ]
        }));
    }
}
exports.CloudWatchLogsRole = CloudWatchLogsRole;
class LoggingRoles extends constructs_1.Construct {
    firehoseRole;
    cloudWatchLogsRole;
    constructor(scope, id, props) {
        super(scope, id);
        const firehose = new FirehoseRole(this, 'Firehose', props);
        const cloudWatchLogs = new CloudWatchLogsRole(this, 'CloudWatchLogs', props);
        this.firehoseRole = firehose.role;
        this.cloudWatchLogsRole = cloudWatchLogs.role;
    }
}
exports.LoggingRoles = LoggingRoles;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWFtLXJvbGVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaWFtLXJvbGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsMkNBQXVDO0FBQ3ZDLHlEQUEyQztBQUMzQyxpREFBOEQ7QUFPOUQsTUFBYSxZQUFhLFNBQVEsc0JBQVM7SUFDekIsSUFBSSxDQUFXO0lBRS9CLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBd0I7UUFDaEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFO1lBQ3JDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx3QkFBd0IsQ0FBQztZQUM3RCxXQUFXLEVBQUUsK0NBQStDO1NBQzdELENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLHlCQUFlLENBQUM7WUFDeEMsTUFBTSxFQUFFLGdCQUFNLENBQUMsS0FBSztZQUNwQixPQUFPLEVBQUU7Z0JBQ1AsTUFBTTtnQkFDTixjQUFjO2FBQ2Y7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsY0FBYyxLQUFLLENBQUMsTUFBTSxhQUFhO2dCQUN2QyxzQkFBc0IsS0FBSyxDQUFDLE1BQU0sYUFBYTthQUNoRDtTQUNGLENBQUMsQ0FBQyxDQUFDO1FBRUosb0RBQW9EO1FBQ3BELElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUkseUJBQWUsQ0FBQztZQUN4QyxNQUFNLEVBQUUsZ0JBQU0sQ0FBQyxLQUFLO1lBQ3BCLE9BQU8sRUFBRTtnQkFDUCx5QkFBeUI7Z0JBQ3pCLHNCQUFzQjtnQkFDdEIsY0FBYztnQkFDZCxlQUFlO2dCQUNmLCtCQUErQjtnQkFDL0IsY0FBYztnQkFDZCxpQkFBaUI7YUFDbEI7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QseUJBQXlCO2dCQUN6QiwyQkFBMkI7Z0JBQzNCLCtCQUErQjtnQkFDL0IsaUNBQWlDO2FBQ2xDO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSiwwREFBMEQ7UUFDMUQsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSx5QkFBZSxDQUFDO1lBQ3hDLE1BQU0sRUFBRSxnQkFBTSxDQUFDLEtBQUs7WUFDcEIsT0FBTyxFQUFFO2dCQUNQLHFCQUFxQjtnQkFDckIsc0JBQXNCO2dCQUN0QixtQkFBbUI7YUFDcEI7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsZ0JBQWdCLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sbUNBQW1DO2dCQUNoRixnQkFBZ0IsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxnREFBZ0Q7YUFDOUY7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLHlCQUFlLENBQUM7WUFDeEMsTUFBTSxFQUFFLGdCQUFNLENBQUMsS0FBSztZQUNwQixPQUFPLEVBQUU7Z0JBQ1Asb0JBQW9CO2dCQUNwQix1QkFBdUI7YUFDeEI7WUFDRCxTQUFTLEVBQUU7Z0JBQ1Qsa0JBQWtCLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sYUFBYTthQUM3RDtTQUNGLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztDQUNGO0FBdEVELG9DQXNFQztBQU9ELE1BQWEsa0JBQW1CLFNBQVEsc0JBQVM7SUFDL0IsSUFBSSxDQUFXO0lBRS9CLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFO1lBQ3JDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEtBQUssQ0FBQyxNQUFNLGdCQUFnQixDQUFDO1lBQ3pFLFdBQVcsRUFBRSxtREFBbUQ7U0FDakUsQ0FBQyxDQUFDO1FBRUgsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUkseUJBQWUsQ0FBQztZQUN4QyxNQUFNLEVBQUUsZ0JBQU0sQ0FBQyxLQUFLO1lBQ3BCLE9BQU8sRUFBRTtnQkFDUCxvQkFBb0I7Z0JBQ3BCLHlCQUF5QjthQUMxQjtZQUNELFNBQVMsRUFBRTtnQkFDVCxvQkFBb0IsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxtQkFBbUI7YUFDckU7U0FDRixDQUFDLENBQUMsQ0FBQztJQUNOLENBQUM7Q0FDRjtBQXZCRCxnREF1QkM7QUFPRCxNQUFhLFlBQWEsU0FBUSxzQkFBUztJQUN6QixZQUFZLENBQVc7SUFDdkIsa0JBQWtCLENBQVc7SUFFN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sUUFBUSxHQUFHLElBQUksWUFBWSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0QsTUFBTSxjQUFjLEdBQUcsSUFBSSxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFN0UsSUFBSSxDQUFDLFlBQVksR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2xDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQ2hELENBQUM7Q0FDRjtBQWJELG9DQWFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIEVmZmVjdCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZpcmVob3NlUm9sZVByb3BzIHtcbiAgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFjY291bnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEZpcmVob3NlUm9sZSBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSByb2xlOiBpYW0uUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRmlyZWhvc2VSb2xlUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5yb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2ZpcmVob3NlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgRmlyZWhvc2UgdG8gYWNjZXNzIE9wZW5TZWFyY2ggYW5kIFMzJyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb21wcmVoZW5zaXZlIE9wZW5TZWFyY2ggcGVybWlzc2lvbnNcbiAgICB0aGlzLnJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2VzOionLFxuICAgICAgICAnb3BlbnNlYXJjaDoqJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czplczoke3Byb3BzLnJlZ2lvbn06Kjpkb21haW4vKmAsXG4gICAgICAgIGBhcm46YXdzOm9wZW5zZWFyY2g6JHtwcm9wcy5yZWdpb259Oio6ZG9tYWluLypgXG4gICAgICBdXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIFMzIHBlcm1pc3Npb25zIGZvciBGaXJlaG9zZSBiYWNrdXAgb3BlcmF0aW9uc1xuICAgIHRoaXMucm9sZS5hZGRUb1BvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnczM6QWJvcnRNdWx0aXBhcnRVcGxvYWQnLFxuICAgICAgICAnczM6R2V0QnVja2V0TG9jYXRpb24nLFxuICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgJ3MzOkxpc3RCdWNrZXQnLFxuICAgICAgICAnczM6TGlzdEJ1Y2tldE11bHRpcGFydFVwbG9hZHMnLFxuICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgJ3MzOlB1dE9iamVjdEFjbCdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgJ2Fybjphd3M6czM6OjpmaXJlaG9zZS0qJyxcbiAgICAgICAgJ2Fybjphd3M6czM6OjpmaXJlaG9zZS0qLyonLFxuICAgICAgICAnYXJuOmF3czpzMzo6OmtpbmVzaXNmaXJlaG9zZSonLFxuICAgICAgICAnYXJuOmF3czpzMzo6OmtpbmVzaXNmaXJlaG9zZSovKidcbiAgICAgIF1cbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgQ2xvdWRXYXRjaCBMb2dzIHBlcm1pc3Npb25zIGZvciBGaXJlaG9zZSBvcGVyYXRpb25zXG4gICAgdGhpcy5yb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpsb2dzOiR7cHJvcHMucmVnaW9ufToke3Byb3BzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2tpbmVzaXNmaXJlaG9zZS8qYCxcbiAgICAgICAgYGFybjphd3M6bG9nczoke3Byb3BzLnJlZ2lvbn06JHtwcm9wcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9raW5lc2lzZmlyZWhvc2UvKjpsb2ctc3RyZWFtOipgXG4gICAgICBdXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIExhbWJkYSBwZXJtaXNzaW9ucyBmb3IgcHJvY2Vzc2luZ1xuICAgIHRoaXMucm9sZS5hZGRUb1BvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnbGFtYmRhOkdldEZ1bmN0aW9uJyxcbiAgICAgICAgJ2xhbWJkYTpJbnZva2VGdW5jdGlvbidcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6bGFtYmRhOiR7cHJvcHMucmVnaW9ufToke3Byb3BzLmFjY291bnR9OmZ1bmN0aW9uOipgXG4gICAgICBdXG4gICAgfSkpO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xvdWRXYXRjaExvZ3NSb2xlUHJvcHMge1xuICByZWFkb25seSByZWdpb246IHN0cmluZztcbiAgcmVhZG9ubHkgYWNjb3VudDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaExvZ3NSb2xlIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDbG91ZFdhdGNoTG9nc1JvbGVQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChgbG9ncy4ke3Byb3BzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWApLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGZvciBDbG91ZFdhdGNoIExvZ3MgdG8gc2VuZCBkYXRhIHRvIEZpcmVob3NlJyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBGaXJlaG9zZSBwZXJtaXNzaW9uc1xuICAgIHRoaXMucm9sZS5hZGRUb1BvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZmlyZWhvc2U6UHV0UmVjb3JkJyxcbiAgICAgICAgJ2ZpcmVob3NlOlB1dFJlY29yZEJhdGNoJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpmaXJlaG9zZToke3Byb3BzLnJlZ2lvbn06JHtwcm9wcy5hY2NvdW50fTpkZWxpdmVyeXN0cmVhbS8qYFxuICAgICAgXVxuICAgIH0pKTtcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ2dpbmdSb2xlc1Byb3BzIHtcbiAgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFjY291bnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExvZ2dpbmdSb2xlcyBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBmaXJlaG9zZVJvbGU6IGlhbS5Sb2xlO1xuICBwdWJsaWMgcmVhZG9ubHkgY2xvdWRXYXRjaExvZ3NSb2xlOiBpYW0uUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTG9nZ2luZ1JvbGVzUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgZmlyZWhvc2UgPSBuZXcgRmlyZWhvc2VSb2xlKHRoaXMsICdGaXJlaG9zZScsIHByb3BzKTtcbiAgICBjb25zdCBjbG91ZFdhdGNoTG9ncyA9IG5ldyBDbG91ZFdhdGNoTG9nc1JvbGUodGhpcywgJ0Nsb3VkV2F0Y2hMb2dzJywgcHJvcHMpO1xuXG4gICAgdGhpcy5maXJlaG9zZVJvbGUgPSBmaXJlaG9zZS5yb2xlO1xuICAgIHRoaXMuY2xvdWRXYXRjaExvZ3NSb2xlID0gY2xvdWRXYXRjaExvZ3Mucm9sZTtcbiAgfVxufSJdfQ==