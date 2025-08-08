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
        return {
            ...config.openSearch,
            version,
            ebsVolumeType,
        };
    }
}
exports.ConfigValidator = ConfigValidator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZFQUFrRTtBQUNsRSxpREFBMEQ7QUFHMUQsTUFBYSxlQUFlO0lBRXhCLGdCQUFnQixDQUFDLEtBQVUsRUFBRSxTQUFpQjtRQUMxQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDVCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyxtQ0FBbUMsQ0FBQyxDQUFDO1FBQ3JFLENBQUM7SUFDTCxDQUFDO0lBRUQscUJBQXFCLENBQUMsYUFBcUI7UUFDdkMsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBRUQsSUFBSSxhQUFhLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDbEMsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMzQyxJQUFJLENBQUM7Z0JBQ0QsT0FBTyxxQ0FBYSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUM3QyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDYixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxhQUFhLDBDQUEwQyxDQUFDLENBQUM7WUFDbkgsQ0FBQztRQUNMLENBQUM7YUFBTSxJQUFJLGFBQWEsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QyxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLElBQUksQ0FBQztnQkFDRCxPQUFPLHFDQUFhLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2hELENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLGFBQWEsMENBQTBDLENBQUMsQ0FBQztZQUN0SCxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDSixNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxhQUFhLHFDQUFxQyxDQUFDLENBQUM7UUFDcEksQ0FBQztJQUNMLENBQUM7SUFFRCxxQkFBcUIsQ0FBQyxpQkFBMEI7UUFDNUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDckIsT0FBTyxTQUFTLENBQUM7UUFDckIsQ0FBQztRQUVELE1BQU0sYUFBYSxHQUFHLDZCQUFtQixDQUFDLGlCQUFxRCxDQUFDLENBQUM7UUFDakcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsaUJBQWlCLHdCQUF3QixVQUFVLHVHQUF1RyxDQUFDLENBQUM7UUFDNU0sQ0FBQztRQUVELE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7SUFFRCwwQkFBMEIsQ0FBQyxNQUEwQjtRQUNqRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUM1RSxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUVsRixJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxLQUFLLENBQUMscURBQXFELE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQztRQUM1RyxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLHlCQUF5QixJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMseUJBQXlCLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDakcsTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsTUFBTSxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsRUFBRSxDQUFDLENBQUM7UUFDakksQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxhQUFhLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDekUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsTUFBTSxDQUFDLFVBQVUsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQ3hHLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxLQUFLLENBQUMscURBQXFELE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQztRQUM1RyxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixJQUFJLENBQUMsRUFBRSxDQUFDO1lBQy9DLE1BQU0sSUFBSSxLQUFLLENBQUMsNkRBQTZELE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFDO1FBQzVILENBQUM7UUFFRCxPQUFPO1lBQ0gsR0FBRyxNQUFNLENBQUMsVUFBVTtZQUNwQixPQUFPO1lBQ1AsYUFBYTtTQUNoQixDQUFDO0lBQ04sQ0FBQztDQUNKO0FBNUVELDBDQTRFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEVuZ2luZVZlcnNpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLW9wZW5zZWFyY2hzZXJ2aWNlXCI7XG5pbXBvcnQgeyBFYnNEZXZpY2VWb2x1bWVUeXBlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lYzJcIjtcbmltcG9ydCB7IFBhcnNlZE9wZW5TZWFyY2hDb25maWcsIFN0YWNrQ29uZmlndXJhdGlvbiB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBDb25maWdWYWxpZGF0b3Ige1xuICAgIFxuICAgIHZhbGlkYXRlUmVxdWlyZWQodmFsdWU6IGFueSwgZmllbGROYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2ZpZWxkTmFtZX0gaXMgcmVxdWlyZWQgYnV0IHdhcyBub3QgcHJvdmlkZWRgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhbGlkYXRlRW5naW5lVmVyc2lvbihlbmdpbmVWZXJzaW9uOiBzdHJpbmcpOiBFbmdpbmVWZXJzaW9uIHtcbiAgICAgICAgaWYgKCFlbmdpbmVWZXJzaW9uKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFbmdpbmUgdmVyc2lvbiBpcyByZXF1aXJlZFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbmdpbmVWZXJzaW9uLnN0YXJ0c1dpdGgoXCJPU19cIikpIHtcbiAgICAgICAgICAgIGNvbnN0IHZlcnNpb24gPSBlbmdpbmVWZXJzaW9uLnN1YnN0cmluZygzKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIEVuZ2luZVZlcnNpb24ub3BlblNlYXJjaCh2ZXJzaW9uKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIE9wZW5TZWFyY2ggdmVyc2lvbiBmb3JtYXQ6ICR7ZW5naW5lVmVyc2lvbn0uIEV4cGVjdGVkIGZvcm1hdDogT1NfeC54IChlLmcuLCBPU18yLjUpYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZW5naW5lVmVyc2lvbi5zdGFydHNXaXRoKFwiRVNfXCIpKSB7XG4gICAgICAgICAgICBjb25zdCB2ZXJzaW9uID0gZW5naW5lVmVyc2lvbi5zdWJzdHJpbmcoMyk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJldHVybiBFbmdpbmVWZXJzaW9uLmVsYXN0aWNzZWFyY2godmVyc2lvbik7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBFbGFzdGljc2VhcmNoIHZlcnNpb24gZm9ybWF0OiAke2VuZ2luZVZlcnNpb259LiBFeHBlY3RlZCBmb3JtYXQ6IEVTX3gueCAoZS5nLiwgRVNfNy45KWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbmdpbmUgdmVyc2lvbiBtdXN0IHN0YXJ0IHdpdGggJ09TXycgb3IgJ0VTXycuIFJlY2VpdmVkOiAke2VuZ2luZVZlcnNpb259LiBFeHBlY3RlZCBmb3JtYXQ6IE9TXzIuNSBvciBFU183LjlgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhbGlkYXRlRWJzVm9sdW1lVHlwZShlYnNWb2x1bWVUeXBlTmFtZT86IHN0cmluZyk6IEVic0RldmljZVZvbHVtZVR5cGUgfCB1bmRlZmluZWQge1xuICAgICAgICBpZiAoIWVic1ZvbHVtZVR5cGVOYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZWJzVm9sdW1lVHlwZSA9IEVic0RldmljZVZvbHVtZVR5cGVbZWJzVm9sdW1lVHlwZU5hbWUgYXMga2V5b2YgdHlwZW9mIEVic0RldmljZVZvbHVtZVR5cGVdO1xuICAgICAgICBpZiAoIWVic1ZvbHVtZVR5cGUpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbGlkVHlwZXMgPSBPYmplY3Qua2V5cyhFYnNEZXZpY2VWb2x1bWVUeXBlKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIEVCUyB2b2x1bWUgdHlwZTogJHtlYnNWb2x1bWVUeXBlTmFtZX0uIFZhbGlkIG9wdGlvbnMgYXJlOiAke3ZhbGlkVHlwZXN9LiBSZWZlcmVuY2U6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jZGsvYXBpL3YyL2RvY3MvYXdzLWNkay1saWIuYXdzX2VjMi5FYnNEZXZpY2VWb2x1bWVUeXBlLmh0bWxgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlYnNWb2x1bWVUeXBlO1xuICAgIH1cblxuICAgIHZhbGlkYXRlQW5kVHJhbnNmb3JtQ29uZmlnKGNvbmZpZzogU3RhY2tDb25maWd1cmF0aW9uKTogUGFyc2VkT3BlblNlYXJjaENvbmZpZyB7XG4gICAgICAgIGNvbnN0IHZlcnNpb24gPSB0aGlzLnZhbGlkYXRlRW5naW5lVmVyc2lvbihjb25maWcub3BlblNlYXJjaC5lbmdpbmVWZXJzaW9uKTtcbiAgICAgICAgY29uc3QgZWJzVm9sdW1lVHlwZSA9IHRoaXMudmFsaWRhdGVFYnNWb2x1bWVUeXBlKGNvbmZpZy5vcGVuU2VhcmNoLmVic1ZvbHVtZVR5cGUpO1xuXG4gICAgICAgIGlmIChjb25maWcub3BlblNlYXJjaC5kYXRhTm9kZUNvdW50IDw9IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRGF0YSBub2RlIGNvdW50IG11c3QgYmUgZ3JlYXRlciB0aGFuIDAuIFJlY2VpdmVkOiAke2NvbmZpZy5vcGVuU2VhcmNoLmRhdGFOb2RlQ291bnR9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLm9wZW5TZWFyY2guZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudCAmJiBjb25maWcub3BlblNlYXJjaC5kZWRpY2F0ZWRNYW5hZ2VyTm9kZUNvdW50IDwgMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEZWRpY2F0ZWQgbWFuYWdlciBub2RlIGNvdW50IGNhbm5vdCBiZSBuZWdhdGl2ZS4gUmVjZWl2ZWQ6ICR7Y29uZmlnLm9wZW5TZWFyY2guZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb25maWcub3BlblNlYXJjaC53YXJtTm9kZUNvdW50ICYmIGNvbmZpZy5vcGVuU2VhcmNoLndhcm1Ob2RlQ291bnQgPCAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFdhcm0gbm9kZSBjb3VudCBjYW5ub3QgYmUgbmVnYXRpdmUuIFJlY2VpdmVkOiAke2NvbmZpZy5vcGVuU2VhcmNoLndhcm1Ob2RlQ291bnR9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLm9wZW5TZWFyY2guZWJzVm9sdW1lU2l6ZSA8PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVCUyB2b2x1bWUgc2l6ZSBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwLiBSZWNlaXZlZDogJHtjb25maWcub3BlblNlYXJjaC5lYnNWb2x1bWVTaXplfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5vcGVuU2VhcmNoLmF2YWlsYWJpbGl0eVpvbmVDb3VudCA8PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF2YWlsYWJpbGl0eSB6b25lIGNvdW50IG11c3QgYmUgZ3JlYXRlciB0aGFuIDAuIFJlY2VpdmVkOiAke2NvbmZpZy5vcGVuU2VhcmNoLmF2YWlsYWJpbGl0eVpvbmVDb3VudH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5jb25maWcub3BlblNlYXJjaCxcbiAgICAgICAgICAgIHZlcnNpb24sXG4gICAgICAgICAgICBlYnNWb2x1bWVUeXBlLFxuICAgICAgICB9O1xuICAgIH1cbn0iXX0=