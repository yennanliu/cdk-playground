"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigParser = void 0;
const validator_1 = require("./validator");
class ConfigParser {
    static parse(scope, stage, defaults) {
        const validator = new validator_1.ConfigValidator();
        const domainName = this.getContextForType(scope, 'domainName', 'string', defaults);
        const engineVersion = this.getContextForType(scope, 'engineVersion', 'string', defaults);
        const dataNodeType = this.getContextForType(scope, 'dataNodeType', 'string', defaults);
        const dataNodeCount = this.getContextForType(scope, 'dataNodeCount', 'number', defaults);
        const dedicatedManagerNodeType = this.getContextForType(scope, 'dedicatedManagerNodeType', 'string', defaults);
        const dedicatedManagerNodeCount = this.getContextForType(scope, 'dedicatedManagerNodeCount', 'number', defaults);
        const warmNodeType = this.getContextForType(scope, 'warmNodeType', 'string', defaults);
        const warmNodeCount = this.getContextForType(scope, 'warmNodeCount', 'number', defaults);
        const ebsEnabled = this.getContextForType(scope, 'ebsEnabled', 'boolean', defaults);
        const ebsIops = this.getContextForType(scope, 'ebsIops', 'number', defaults);
        const ebsVolumeSize = this.getContextForType(scope, 'ebsVolumeSize', 'number', defaults);
        const ebsVolumeType = this.getContextForType(scope, 'ebsVolumeType', 'string', defaults);
        const vpcEnabled = this.getContextForType(scope, 'vpcEnabled', 'boolean', defaults);
        const vpcId = this.getContextForType(scope, 'vpcId', 'string', defaults);
        const vpcSubnetIds = this.getContextForType(scope, 'vpcSubnetIds', 'object', defaults);
        const vpcSecurityGroupIds = this.getContextForType(scope, 'vpcSecurityGroupIds', 'object', defaults);
        const availabilityZoneCount = this.getContextForType(scope, 'availabilityZoneCount', 'number', defaults);
        const eksLogGroupName = this.getContextForType(scope, 'eksLogGroupName', 'string', defaults);
        const podLogGroupName = this.getContextForType(scope, 'podLogGroupName', 'string', defaults);
        validator.validateRequired(domainName, 'domainName');
        validator.validateEngineVersion(engineVersion);
        validator.validateEbsVolumeType(ebsVolumeType);
        return {
            openSearch: {
                domainName: domainName,
                engineVersion: engineVersion,
                dataNodeType: dataNodeType || 't3.small.search',
                dataNodeCount: dataNodeCount || 1,
                dedicatedManagerNodeType,
                dedicatedManagerNodeCount,
                warmNodeType,
                warmNodeCount,
                ebsEnabled: ebsEnabled !== undefined ? ebsEnabled : true,
                ebsIops,
                ebsVolumeSize: ebsVolumeSize || 10,
                ebsVolumeType,
                availabilityZoneCount: availabilityZoneCount || 1,
            },
            network: {
                vpcEnabled: vpcEnabled || false,
                vpcId,
                vpcSubnetIds,
                vpcSecurityGroupIds,
                availabilityZoneCount: availabilityZoneCount || 1,
            },
            logs: {
                eksLogGroupName,
                podLogGroupName,
            },
            stage,
        };
    }
    static getContextForType(scope, optionName, expectedType, defaultValues) {
        const option = scope.node.tryGetContext(optionName);
        // If no context is provided (undefined or empty string) and a default value exists, use it
        if ((option === undefined || option === "") && defaultValues[optionName]) {
            return defaultValues[optionName];
        }
        // Filter out invalid or missing options by setting undefined (empty strings, null, undefined, NaN)
        if (option !== false && option !== 0 && !option) {
            return undefined;
        }
        // Values provided by the CLI will always be represented as a string and need to be parsed
        if (typeof option === 'string') {
            if (expectedType === 'number') {
                const parsed = parseInt(option);
                if (isNaN(parsed)) {
                    throw new Error(`Invalid number format for ${optionName}: ${option}`);
                }
                return parsed;
            }
            if (expectedType === 'boolean' || expectedType === 'object') {
                try {
                    return JSON.parse(option);
                }
                catch (error) {
                    throw new Error(`Invalid JSON format for ${optionName}: ${option}`);
                }
            }
        }
        // Values provided by the cdk.context.json should be of the desired type
        if (typeof option !== expectedType) {
            throw new Error(`Type provided by cdk.context.json for ${optionName} was ${typeof option} but expected ${expectedType}`);
        }
        return option;
    }
}
exports.ConfigParser = ConfigParser;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGFyc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicGFyc2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDJDQUE4QztBQUU5QyxNQUFhLFlBQVk7SUFFckIsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFnQixFQUFFLEtBQWEsRUFBRSxRQUEyQjtRQUNyRSxNQUFNLFNBQVMsR0FBRyxJQUFJLDJCQUFlLEVBQUUsQ0FBQztRQUV4QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDbkYsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3pGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUN2RixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLGVBQWUsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDekYsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLDBCQUEwQixFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUMvRyxNQUFNLHlCQUF5QixHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsMkJBQTJCLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ2pILE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUN2RixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLGVB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QyxNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxVQUFVLFFBQVEsT0FBTyxNQUFNLGlCQUFpQixZQUFZLEVBQUUsQ0FBQyxDQUFDO1FBQzdILENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQztJQUNsQixDQUFDO0NBQ0o7QUF2R0Qsb0NBdUdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFJhd0NvbmZpZ0RlZmF1bHRzLCBTdGFja0NvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgQ29uZmlnVmFsaWRhdG9yIH0gZnJvbSBcIi4vdmFsaWRhdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDb25maWdQYXJzZXIge1xuICAgIFxuICAgIHN0YXRpYyBwYXJzZShzY29wZTogQ29uc3RydWN0LCBzdGFnZTogc3RyaW5nLCBkZWZhdWx0czogUmF3Q29uZmlnRGVmYXVsdHMpOiBTdGFja0NvbmZpZ3VyYXRpb24ge1xuICAgICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgQ29uZmlnVmFsaWRhdG9yKCk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBkb21haW5OYW1lID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ2RvbWFpbk5hbWUnLCAnc3RyaW5nJywgZGVmYXVsdHMpO1xuICAgICAgICBjb25zdCBlbmdpbmVWZXJzaW9uID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ2VuZ2luZVZlcnNpb24nLCAnc3RyaW5nJywgZGVmYXVsdHMpO1xuICAgICAgICBjb25zdCBkYXRhTm9kZVR5cGUgPSB0aGlzLmdldENvbnRleHRGb3JUeXBlKHNjb3BlLCAnZGF0YU5vZGVUeXBlJywgJ3N0cmluZycsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgZGF0YU5vZGVDb3VudCA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICdkYXRhTm9kZUNvdW50JywgJ251bWJlcicsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgZGVkaWNhdGVkTWFuYWdlck5vZGVUeXBlID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ2RlZGljYXRlZE1hbmFnZXJOb2RlVHlwZScsICdzdHJpbmcnLCBkZWZhdWx0cyk7XG4gICAgICAgIGNvbnN0IGRlZGljYXRlZE1hbmFnZXJOb2RlQ291bnQgPSB0aGlzLmdldENvbnRleHRGb3JUeXBlKHNjb3BlLCAnZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudCcsICdudW1iZXInLCBkZWZhdWx0cyk7XG4gICAgICAgIGNvbnN0IHdhcm1Ob2RlVHlwZSA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICd3YXJtTm9kZVR5cGUnLCAnc3RyaW5nJywgZGVmYXVsdHMpO1xuICAgICAgICBjb25zdCB3YXJtTm9kZUNvdW50ID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ3dhcm1Ob2RlQ291bnQnLCAnbnVtYmVyJywgZGVmYXVsdHMpO1xuICAgICAgICBjb25zdCBlYnNFbmFibGVkID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ2Vic0VuYWJsZWQnLCAnYm9vbGVhbicsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgZWJzSW9wcyA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICdlYnNJb3BzJywgJ251bWJlcicsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgZWJzVm9sdW1lU2l6ZSA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICdlYnNWb2x1bWVTaXplJywgJ251bWJlcicsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgZWJzVm9sdW1lVHlwZSA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICdlYnNWb2x1bWVUeXBlJywgJ3N0cmluZycsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgdnBjRW5hYmxlZCA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICd2cGNFbmFibGVkJywgJ2Jvb2xlYW4nLCBkZWZhdWx0cyk7XG4gICAgICAgIGNvbnN0IHZwY0lkID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ3ZwY0lkJywgJ3N0cmluZycsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgdnBjU3VibmV0SWRzID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ3ZwY1N1Ym5ldElkcycsICdvYmplY3QnLCBkZWZhdWx0cyk7XG4gICAgICAgIGNvbnN0IHZwY1NlY3VyaXR5R3JvdXBJZHMgPSB0aGlzLmdldENvbnRleHRGb3JUeXBlKHNjb3BlLCAndnBjU2VjdXJpdHlHcm91cElkcycsICdvYmplY3QnLCBkZWZhdWx0cyk7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJpbGl0eVpvbmVDb3VudCA9IHRoaXMuZ2V0Q29udGV4dEZvclR5cGUoc2NvcGUsICdhdmFpbGFiaWxpdHlab25lQ291bnQnLCAnbnVtYmVyJywgZGVmYXVsdHMpO1xuICAgICAgICBjb25zdCBla3NMb2dHcm91cE5hbWUgPSB0aGlzLmdldENvbnRleHRGb3JUeXBlKHNjb3BlLCAnZWtzTG9nR3JvdXBOYW1lJywgJ3N0cmluZycsIGRlZmF1bHRzKTtcbiAgICAgICAgY29uc3QgcG9kTG9nR3JvdXBOYW1lID0gdGhpcy5nZXRDb250ZXh0Rm9yVHlwZShzY29wZSwgJ3BvZExvZ0dyb3VwTmFtZScsICdzdHJpbmcnLCBkZWZhdWx0cyk7XG5cbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlUmVxdWlyZWQoZG9tYWluTmFtZSwgJ2RvbWFpbk5hbWUnKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRW5naW5lVmVyc2lvbihlbmdpbmVWZXJzaW9uKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRWJzVm9sdW1lVHlwZShlYnNWb2x1bWVUeXBlKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgb3BlblNlYXJjaDoge1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IGRvbWFpbk5hbWUhLFxuICAgICAgICAgICAgICAgIGVuZ2luZVZlcnNpb246IGVuZ2luZVZlcnNpb24hLFxuICAgICAgICAgICAgICAgIGRhdGFOb2RlVHlwZTogZGF0YU5vZGVUeXBlIHx8ICd0My5zbWFsbC5zZWFyY2gnLFxuICAgICAgICAgICAgICAgIGRhdGFOb2RlQ291bnQ6IGRhdGFOb2RlQ291bnQgfHwgMSxcbiAgICAgICAgICAgICAgICBkZWRpY2F0ZWRNYW5hZ2VyTm9kZVR5cGUsXG4gICAgICAgICAgICAgICAgZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudCxcbiAgICAgICAgICAgICAgICB3YXJtTm9kZVR5cGUsXG4gICAgICAgICAgICAgICAgd2FybU5vZGVDb3VudCxcbiAgICAgICAgICAgICAgICBlYnNFbmFibGVkOiBlYnNFbmFibGVkICE9PSB1bmRlZmluZWQgPyBlYnNFbmFibGVkIDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlYnNJb3BzLFxuICAgICAgICAgICAgICAgIGVic1ZvbHVtZVNpemU6IGVic1ZvbHVtZVNpemUgfHwgMTAsXG4gICAgICAgICAgICAgICAgZWJzVm9sdW1lVHlwZSxcbiAgICAgICAgICAgICAgICBhdmFpbGFiaWxpdHlab25lQ291bnQ6IGF2YWlsYWJpbGl0eVpvbmVDb3VudCB8fCAxLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG5ldHdvcms6IHtcbiAgICAgICAgICAgICAgICB2cGNFbmFibGVkOiB2cGNFbmFibGVkIHx8IGZhbHNlLFxuICAgICAgICAgICAgICAgIHZwY0lkLFxuICAgICAgICAgICAgICAgIHZwY1N1Ym5ldElkcyxcbiAgICAgICAgICAgICAgICB2cGNTZWN1cml0eUdyb3VwSWRzLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJpbGl0eVpvbmVDb3VudDogYXZhaWxhYmlsaXR5Wm9uZUNvdW50IHx8IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbG9nczoge1xuICAgICAgICAgICAgICAgIGVrc0xvZ0dyb3VwTmFtZSxcbiAgICAgICAgICAgICAgICBwb2RMb2dHcm91cE5hbWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhZ2UsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzdGF0aWMgZ2V0Q29udGV4dEZvclR5cGUoXG4gICAgICAgIHNjb3BlOiBDb25zdHJ1Y3QsIFxuICAgICAgICBvcHRpb25OYW1lOiBzdHJpbmcsIFxuICAgICAgICBleHBlY3RlZFR5cGU6IHN0cmluZywgXG4gICAgICAgIGRlZmF1bHRWYWx1ZXM6IFJhd0NvbmZpZ0RlZmF1bHRzXG4gICAgKTogYW55IHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2NvcGUubm9kZS50cnlHZXRDb250ZXh0KG9wdGlvbk5hbWUpO1xuXG4gICAgICAgIC8vIElmIG5vIGNvbnRleHQgaXMgcHJvdmlkZWQgKHVuZGVmaW5lZCBvciBlbXB0eSBzdHJpbmcpIGFuZCBhIGRlZmF1bHQgdmFsdWUgZXhpc3RzLCB1c2UgaXRcbiAgICAgICAgaWYgKChvcHRpb24gPT09IHVuZGVmaW5lZCB8fCBvcHRpb24gPT09IFwiXCIpICYmIGRlZmF1bHRWYWx1ZXNbb3B0aW9uTmFtZSBhcyBrZXlvZiBSYXdDb25maWdEZWZhdWx0c10pIHtcbiAgICAgICAgICAgIHJldHVybiBkZWZhdWx0VmFsdWVzW29wdGlvbk5hbWUgYXMga2V5b2YgUmF3Q29uZmlnRGVmYXVsdHNdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmlsdGVyIG91dCBpbnZhbGlkIG9yIG1pc3Npbmcgb3B0aW9ucyBieSBzZXR0aW5nIHVuZGVmaW5lZCAoZW1wdHkgc3RyaW5ncywgbnVsbCwgdW5kZWZpbmVkLCBOYU4pXG4gICAgICAgIGlmIChvcHRpb24gIT09IGZhbHNlICYmIG9wdGlvbiAhPT0gMCAmJiAhb3B0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsdWVzIHByb3ZpZGVkIGJ5IHRoZSBDTEkgd2lsbCBhbHdheXMgYmUgcmVwcmVzZW50ZWQgYXMgYSBzdHJpbmcgYW5kIG5lZWQgdG8gYmUgcGFyc2VkXG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9uID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgaWYgKGV4cGVjdGVkVHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUludChvcHRpb24pO1xuICAgICAgICAgICAgICAgIGlmIChpc05hTihwYXJzZWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBudW1iZXIgZm9ybWF0IGZvciAke29wdGlvbk5hbWV9OiAke29wdGlvbn1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcnNlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChleHBlY3RlZFR5cGUgPT09ICdib29sZWFuJyB8fCBleHBlY3RlZFR5cGUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2Uob3B0aW9uKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgSlNPTiBmb3JtYXQgZm9yICR7b3B0aW9uTmFtZX06ICR7b3B0aW9ufWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbHVlcyBwcm92aWRlZCBieSB0aGUgY2RrLmNvbnRleHQuanNvbiBzaG91bGQgYmUgb2YgdGhlIGRlc2lyZWQgdHlwZVxuICAgICAgICBpZiAodHlwZW9mIG9wdGlvbiAhPT0gZXhwZWN0ZWRUeXBlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFR5cGUgcHJvdmlkZWQgYnkgY2RrLmNvbnRleHQuanNvbiBmb3IgJHtvcHRpb25OYW1lfSB3YXMgJHt0eXBlb2Ygb3B0aW9ufSBidXQgZXhwZWN0ZWQgJHtleHBlY3RlZFR5cGV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gb3B0aW9uO1xuICAgIH1cbn0iXX0=