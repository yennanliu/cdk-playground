"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigValidator = void 0;
const aws_opensearchservice_1 = require("aws-cdk-lib/aws-opensearchservice");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
class ConfigValidator {
    validateRequired(value, fieldName) {
        if (!value) {
            throw new Error(`${fieldName} is required but was not provided`);
        }
    }
    validateEngineVersion(engineVersion) {
        if (!engineVersion) {
            throw new Error("Engine version is required");
        }
        if (engineVersion.startsWith("OS_")) {
            const version = engineVersion.substring(3);
            try {
                return aws_opensearchservice_1.EngineVersion.openSearch(version);
            }
            catch (error) {
                throw new Error(`Invalid OpenSearch version format: ${engineVersion}. Expected format: OS_x.x (e.g., OS_2.5)`);
            }
        }
        else if (engineVersion.startsWith("ES_")) {
            const version = engineVersion.substring(3);
            try {
                return aws_opensearchservice_1.EngineVersion.elasticsearch(version);
            }
            catch (error) {
                throw new Error(`Invalid Elasticsearch version format: ${engineVersion}. Expected format: ES_x.x (e.g., ES_7.9)`);
            }
        }
        else {
            throw new Error(`Engine version must start with 'OS_' or 'ES_'. Received: ${engineVersion}. Expected format: OS_2.5 or ES_7.9`);
        }
    }
    validateEbsVolumeType(ebsVolumeTypeName) {
        if (!ebsVolumeTypeName) {
            return undefined;
        }
        const ebsVolumeType = aws_ec2_1.EbsDeviceVolumeType[ebsVolumeTypeName];
        if (!ebsVolumeType) {
            const validTypes = Object.keys(aws_ec2_1.EbsDeviceVolumeType).join(', ');
            throw new Error(`Invalid EBS volume type: ${ebsVolumeTypeName}. Valid options are: ${validTypes}. Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.EbsDeviceVolumeType.html`);
        }
        return ebsVolumeType;
    }
    validateAndTransformConfig(config) {
        const version = this.validateEngineVersion(config.openSearch.engineVersion);
        const ebsVolumeType = this.validateEbsVolumeType(config.openSearch.ebsVolumeType);
        if (config.openSearch.dataNodeCount <= 0) {
            throw new Error(`Data node count must be greater than 0. Received: ${config.openSearch.dataNodeCount}`);
        }
        if (config.openSearch.dedicatedManagerNodeCount && config.openSearch.dedicatedManagerNodeCount < 0) {
            throw new Error(`Dedicated manager node count cannot be negative. Received: ${config.openSearch.dedicatedManagerNodeCount}`);
        }
        if (config.openSearch.warmNodeCount && config.openSearch.warmNodeCount < 0) {
            throw new Error(`Warm node count cannot be negative. Received: ${config.openSearch.warmNodeCount}`);
        }
        if (config.openSearch.ebsVolumeSize <= 0) {
            throw new Error(`EBS volume size must be greater than 0. Received: ${config.openSearch.ebsVolumeSize}`);
        }
        if (config.openSearch.availabilityZoneCount <= 0) {
            throw new Error(`Availability zone count must be greater than 0. Received: ${config.openSearch.availabilityZoneCount}`);
        }
        // Validate service configurations
        this.validateServices(config.logs.services);
        return {
            ...config.openSearch,
            version,
            ebsVolumeType,
        };
    }
    validateServices(services) {
        if (!services) {
            return;
        }
        Object.entries(services).forEach(([serviceName, serviceConfig]) => {
            if (!serviceConfig.logGroupName) {
                throw new Error(`Service '${serviceName}' must have a logGroupName specified`);
            }
            if (!serviceConfig.indexName) {
                throw new Error(`Service '${serviceName}' must have an indexName specified`);
            }
            // Validate service name format
            if (!/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(serviceName)) {
                throw new Error(`Service name '${serviceName}' must start with a letter and contain only letters, numbers, hyphens, and underscores`);
            }
            // Validate index name format
            if (!/^[a-z][a-z0-9-_]*$/.test(serviceConfig.indexName)) {
                throw new Error(`Index name '${serviceConfig.indexName}' for service '${serviceName}' must be lowercase and contain only letters, numbers, hyphens, and underscores`);
            }
            // Validate log group name format
            if (!serviceConfig.logGroupName.startsWith('/')) {
                throw new Error(`Log group name '${serviceConfig.logGroupName}' for service '${serviceName}' must start with '/'`);
            }
        });
    }
}
exports.ConfigValidator = ConfigValidator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZFQUFrRTtBQUNsRSxpREFBMEQ7QUFHMUQsTUFBYSxlQUFlO0lBRXhCLGdCQUFnQixDQUFDLEtBQVUsRUFBRSxTQUFpQjtRQUMxQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyxtQ0FBbUMsQ0FBQyxDQUFDO1FBQ3JFLENBQUM7SUFDTCxDQUFDO0lBRUQscUJBQXFCLENBQUMsYUFBcUI7UUFDdkMsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBRUQsSUFBSSxhQUFhLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDbEMsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMzQyxJQUFJLENBQUM7Z0JBQ0QsT0FBTyxxQ0FBYSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUM3QyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDYixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxhQUFhLDBDQUEwQyxDQUFDLENBQUM7WUFDbkgsQ0FBQztRQUNMLENBQUM7YUFBTSxJQUFJLGFBQWEsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QyxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLElBQUksQ0FBQztnQkFDRCxPQUFPLHFDQUFhLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2hELENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNiLE1BQU0sSUFBSSxLQUFLLENB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QUFDO2dCQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksV0FBVyxzQ0FBc0MsQ0FBQyxDQUFDO1lBQ25GLENBQUM7WUFFRCxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxDQUFDO2dCQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksV0FBVyxvQ0FBb0MsQ0FBQyxDQUFDO1lBQ2pGLENBQUM7WUFFRCwrQkFBK0I7WUFDL0IsSUFBSSxDQUFDLDBCQUEwQixDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO2dCQUNoRCxNQUFNLElBQUksS0FBSyxDQUFDLGlCQUFpQixXQUFXLHdGQUF3RixDQUFDLENBQUM7WUFDMUksQ0FBQztZQUVELDZCQUE2QjtZQUM3QixJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUN0RCxNQUFNLElBQUksS0FBSyxDQUFDLGVBQWUsYUFBYSxDQUFDLFNBQVMsa0JBQWtCLFdBQVcsaUZBQWlGLENBQUMsQ0FBQztZQUMxSyxDQUFDO1lBRUQsaUNBQWlDO1lBQ2pDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUM5QyxNQUFNLElBQUksS0FBSyxDQUFDLG1CQUFtQixhQUFhLENBQUMsWUFBWSxrQkFBa0IsV0FBVyx1QkFBdUIsQ0FBQyxDQUFDO1lBQ3ZILENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQTlHRCwwQ0E4R0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFbmdpbmVWZXJzaW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmljZVwiO1xuaW1wb3J0IHsgRWJzRGV2aWNlVm9sdW1lVHlwZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWMyXCI7XG5pbXBvcnQgeyBQYXJzZWRPcGVuU2VhcmNoQ29uZmlnLCBTdGFja0NvbmZpZ3VyYXRpb24sIFNlcnZpY2VMb2dDb25maWcgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ29uZmlnVmFsaWRhdG9yIHtcbiAgICBcbiAgICB2YWxpZGF0ZVJlcXVpcmVkKHZhbHVlOiBhbnksIGZpZWxkTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtmaWVsZE5hbWV9IGlzIHJlcXVpcmVkIGJ1dCB3YXMgbm90IHByb3ZpZGVkYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUVuZ2luZVZlcnNpb24oZW5naW5lVmVyc2lvbjogc3RyaW5nKTogRW5naW5lVmVyc2lvbiB7XG4gICAgICAgIGlmICghZW5naW5lVmVyc2lvbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRW5naW5lIHZlcnNpb24gaXMgcmVxdWlyZWRcIik7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW5naW5lVmVyc2lvbi5zdGFydHNXaXRoKFwiT1NfXCIpKSB7XG4gICAgICAgICAgICBjb25zdCB2ZXJzaW9uID0gZW5naW5lVmVyc2lvbi5zdWJzdHJpbmcoMyk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJldHVybiBFbmdpbmVWZXJzaW9uLm9wZW5TZWFyY2godmVyc2lvbik7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBPcGVuU2VhcmNoIHZlcnNpb24gZm9ybWF0OiAke2VuZ2luZVZlcnNpb259LiBFeHBlY3RlZCBmb3JtYXQ6IE9TX3gueCAoZS5nLiwgT1NfMi41KWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGVuZ2luZVZlcnNpb24uc3RhcnRzV2l0aChcIkVTX1wiKSkge1xuICAgICAgICAgICAgY29uc3QgdmVyc2lvbiA9IGVuZ2luZVZlcnNpb24uc3Vic3RyaW5nKDMpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gRW5naW5lVmVyc2lvbi5lbGFzdGljc2VhcmNoKHZlcnNpb24pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgRWxhc3RpY3NlYXJjaCB2ZXJzaW9uIGZvcm1hdDogJHtlbmdpbmVWZXJzaW9ufS4gRXhwZWN0ZWQgZm9ybWF0OiBFU194LnggKGUuZy4sIEVTXzcuOSlgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW5naW5lIHZlcnNpb24gbXVzdCBzdGFydCB3aXRoICdPU18nIG9yICdFU18nLiBSZWNlaXZlZDogJHtlbmdpbmVWZXJzaW9ufS4gRXhwZWN0ZWQgZm9ybWF0OiBPU18yLjUgb3IgRVNfNy45YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUVic1ZvbHVtZVR5cGUoZWJzVm9sdW1lVHlwZU5hbWU/OiBzdHJpbmcpOiBFYnNEZXZpY2VWb2x1bWVUeXBlIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKCFlYnNWb2x1bWVUeXBlTmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVic1ZvbHVtZVR5cGUgPSBFYnNEZXZpY2VWb2x1bWVUeXBlW2Vic1ZvbHVtZVR5cGVOYW1lIGFzIGtleW9mIHR5cGVvZiBFYnNEZXZpY2VWb2x1bWVUeXBlXTtcbiAgICAgICAgaWYgKCFlYnNWb2x1bWVUeXBlKSB7XG4gICAgICAgICAgICBjb25zdCB2YWxpZFR5cGVzID0gT2JqZWN0LmtleXMoRWJzRGV2aWNlVm9sdW1lVHlwZSkuam9pbignLCAnKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBFQlMgdm9sdW1lIHR5cGU6ICR7ZWJzVm9sdW1lVHlwZU5hbWV9LiBWYWxpZCBvcHRpb25zIGFyZTogJHt2YWxpZFR5cGVzfS4gUmVmZXJlbmNlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY2RrL2FwaS92Mi9kb2NzL2F3cy1jZGstbGliLmF3c19lYzIuRWJzRGV2aWNlVm9sdW1lVHlwZS5odG1sYCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZWJzVm9sdW1lVHlwZTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZUFuZFRyYW5zZm9ybUNvbmZpZyhjb25maWc6IFN0YWNrQ29uZmlndXJhdGlvbik6IFBhcnNlZE9wZW5TZWFyY2hDb25maWcge1xuICAgICAgICBjb25zdCB2ZXJzaW9uID0gdGhpcy52YWxpZGF0ZUVuZ2luZVZlcnNpb24oY29uZmlnLm9wZW5TZWFyY2guZW5naW5lVmVyc2lvbik7XG4gICAgICAgIGNvbnN0IGVic1ZvbHVtZVR5cGUgPSB0aGlzLnZhbGlkYXRlRWJzVm9sdW1lVHlwZShjb25maWcub3BlblNlYXJjaC5lYnNWb2x1bWVUeXBlKTtcblxuICAgICAgICBpZiAoY29uZmlnLm9wZW5TZWFyY2guZGF0YU5vZGVDb3VudCA8PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYERhdGEgbm9kZSBjb3VudCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwLiBSZWNlaXZlZDogJHtjb25maWcub3BlblNlYXJjaC5kYXRhTm9kZUNvdW50fWApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5vcGVuU2VhcmNoLmRlZGljYXRlZE1hbmFnZXJOb2RlQ291bnQgJiYgY29uZmlnLm9wZW5TZWFyY2guZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudCA8IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRGVkaWNhdGVkIG1hbmFnZXIgbm9kZSBjb3VudCBjYW5ub3QgYmUgbmVnYXRpdmUuIFJlY2VpdmVkOiAke2NvbmZpZy5vcGVuU2VhcmNoLmRlZGljYXRlZE1hbmFnZXJOb2RlQ291bnR9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLm9wZW5TZWFyY2gud2FybU5vZGVDb3VudCAmJiBjb25maWcub3BlblNlYXJjaC53YXJtTm9kZUNvdW50IDwgMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBXYXJtIG5vZGUgY291bnQgY2Fubm90IGJlIG5lZ2F0aXZlLiBSZWNlaXZlZDogJHtjb25maWcub3BlblNlYXJjaC53YXJtTm9kZUNvdW50fWApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5vcGVuU2VhcmNoLmVic1ZvbHVtZVNpemUgPD0gMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFQlMgdm9sdW1lIHNpemUgbXVzdCBiZSBncmVhdGVyIHRoYW4gMC4gUmVjZWl2ZWQ6ICR7Y29uZmlnLm9wZW5TZWFyY2guZWJzVm9sdW1lU2l6ZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb25maWcub3BlblNlYXJjaC5hdmFpbGFiaWxpdHlab25lQ291bnQgPD0gMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdmFpbGFiaWxpdHkgem9uZSBjb3VudCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwLiBSZWNlaXZlZDogJHtjb25maWcub3BlblNlYXJjaC5hdmFpbGFiaWxpdHlab25lQ291bnR9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBzZXJ2aWNlIGNvbmZpZ3VyYXRpb25zXG4gICAgICAgIHRoaXMudmFsaWRhdGVTZXJ2aWNlcyhjb25maWcubG9ncy5zZXJ2aWNlcyk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmNvbmZpZy5vcGVuU2VhcmNoLFxuICAgICAgICAgICAgdmVyc2lvbixcbiAgICAgICAgICAgIGVic1ZvbHVtZVR5cGUsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZVNlcnZpY2VzKHNlcnZpY2VzPzogeyBba2V5OiBzdHJpbmddOiBTZXJ2aWNlTG9nQ29uZmlnIH0pOiB2b2lkIHtcbiAgICAgICAgaWYgKCFzZXJ2aWNlcykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2VydmljZXMpLmZvckVhY2goKFtzZXJ2aWNlTmFtZSwgc2VydmljZUNvbmZpZ10pID0+IHtcbiAgICAgICAgICAgIGlmICghc2VydmljZUNvbmZpZy5sb2dHcm91cE5hbWUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJyR7c2VydmljZU5hbWV9JyBtdXN0IGhhdmUgYSBsb2dHcm91cE5hbWUgc3BlY2lmaWVkYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghc2VydmljZUNvbmZpZy5pbmRleE5hbWUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJyR7c2VydmljZU5hbWV9JyBtdXN0IGhhdmUgYW4gaW5kZXhOYW1lIHNwZWNpZmllZGApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBzZXJ2aWNlIG5hbWUgZm9ybWF0XG4gICAgICAgICAgICBpZiAoIS9eW2EtekEtWl1bYS16QS1aMC05LV9dKiQvLnRlc3Qoc2VydmljZU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlIG5hbWUgJyR7c2VydmljZU5hbWV9JyBtdXN0IHN0YXJ0IHdpdGggYSBsZXR0ZXIgYW5kIGNvbnRhaW4gb25seSBsZXR0ZXJzLCBudW1iZXJzLCBoeXBoZW5zLCBhbmQgdW5kZXJzY29yZXNgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgaW5kZXggbmFtZSBmb3JtYXRcbiAgICAgICAgICAgIGlmICghL15bYS16XVthLXowLTktX10qJC8udGVzdChzZXJ2aWNlQ29uZmlnLmluZGV4TmFtZSkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluZGV4IG5hbWUgJyR7c2VydmljZUNvbmZpZy5pbmRleE5hbWV9JyBmb3Igc2VydmljZSAnJHtzZXJ2aWNlTmFtZX0nIG11c3QgYmUgbG93ZXJjYXNlIGFuZCBjb250YWluIG9ubHkgbGV0dGVycywgbnVtYmVycywgaHlwaGVucywgYW5kIHVuZGVyc2NvcmVzYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIGxvZyBncm91cCBuYW1lIGZvcm1hdFxuICAgICAgICAgICAgaWYgKCFzZXJ2aWNlQ29uZmlnLmxvZ0dyb3VwTmFtZS5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvZyBncm91cCBuYW1lICcke3NlcnZpY2VDb25maWcubG9nR3JvdXBOYW1lfScgZm9yIHNlcnZpY2UgJyR7c2VydmljZU5hbWV9JyBtdXN0IHN0YXJ0IHdpdGggJy8nYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=