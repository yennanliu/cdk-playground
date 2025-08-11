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
exports.ConfigManager = exports.ConfigValidator = void 0;
const parser_1 = require("./parser");
const devDefaults = __importStar(require("./dev.json"));
const prodDefaults = __importStar(require("./prod.json"));
var validator_1 = require("./validator");
Object.defineProperty(exports, "ConfigValidator", { enumerable: true, get: function () { return validator_1.ConfigValidator; } });
class ConfigManager {
    static loadConfiguration(scope, stage) {
        const defaults = this.getDefaultsForStage(stage);
        return parser_1.ConfigParser.parse(scope, stage, defaults);
    }
    static getDefaultsForStage(stage) {
        switch (stage.toLowerCase()) {
            case 'dev':
            case 'development':
                return devDefaults;
            case 'prod':
            case 'production':
                return prodDefaults;
            default:
                // Fallback to dev defaults for unknown stages
                return devDefaults;
        }
    }
}
exports.ConfigManager = ConfigManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVBLHFDQUF3QztBQUN4Qyx3REFBMEM7QUFDMUMsMERBQTRDO0FBRzVDLHlDQUE4QztBQUFyQyw0R0FBQSxlQUFlLE9BQUE7QUFFeEIsTUFBYSxhQUFhO0lBQ3RCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFnQixFQUFFLEtBQWE7UUFDcEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2pELE9BQU8scUJBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU8sTUFBTSxDQUFDLG1CQUFtQixDQUFDLEtBQWE7UUFDNUMsUUFBUSxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUMxQixLQUFLLEtBQUssQ0FBQztZQUNYLEtBQUssYUFBYTtnQkFDZCxPQUFPLFdBQVcsQ0FBQztZQUN2QixLQUFLLE1BQU0sQ0FBQztZQUNaLEtBQUssWUFBWTtnQkFDYixPQUFPLFlBQVksQ0FBQztZQUN4QjtnQkFDSSw4Q0FBOEM7Z0JBQzlDLE9BQU8sV0FBVyxDQUFDO1FBQzNCLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFuQkQsc0NBbUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFN0YWNrQ29uZmlndXJhdGlvbiwgUmF3Q29uZmlnRGVmYXVsdHMgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgQ29uZmlnUGFyc2VyIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgKiBhcyBkZXZEZWZhdWx0cyBmcm9tIFwiLi9kZXYuanNvblwiO1xuaW1wb3J0ICogYXMgcHJvZERlZmF1bHRzIGZyb20gXCIuL3Byb2QuanNvblwiO1xuXG5leHBvcnQgeyBTdGFja0NvbmZpZ3VyYXRpb24sIFBhcnNlZE9wZW5TZWFyY2hDb25maWcsIFNlcnZpY2VMb2dDb25maWcsIExvZ0NvbmZpZyB9IGZyb20gXCIuL3R5cGVzXCI7XG5leHBvcnQgeyBDb25maWdWYWxpZGF0b3IgfSBmcm9tIFwiLi92YWxpZGF0b3JcIjtcblxuZXhwb3J0IGNsYXNzIENvbmZpZ01hbmFnZXIge1xuICAgIHN0YXRpYyBsb2FkQ29uZmlndXJhdGlvbihzY29wZTogQ29uc3RydWN0LCBzdGFnZTogc3RyaW5nKTogU3RhY2tDb25maWd1cmF0aW9uIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmdldERlZmF1bHRzRm9yU3RhZ2Uoc3RhZ2UpO1xuICAgICAgICByZXR1cm4gQ29uZmlnUGFyc2VyLnBhcnNlKHNjb3BlLCBzdGFnZSwgZGVmYXVsdHMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIGdldERlZmF1bHRzRm9yU3RhZ2Uoc3RhZ2U6IHN0cmluZyk6IFJhd0NvbmZpZ0RlZmF1bHRzIHtcbiAgICAgICAgc3dpdGNoIChzdGFnZS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICAgICAgICBjYXNlICdkZXYnOlxuICAgICAgICAgICAgY2FzZSAnZGV2ZWxvcG1lbnQnOlxuICAgICAgICAgICAgICAgIHJldHVybiBkZXZEZWZhdWx0cztcbiAgICAgICAgICAgIGNhc2UgJ3Byb2QnOlxuICAgICAgICAgICAgY2FzZSAncHJvZHVjdGlvbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb2REZWZhdWx0cztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gZGV2IGRlZmF1bHRzIGZvciB1bmtub3duIHN0YWdlc1xuICAgICAgICAgICAgICAgIHJldHVybiBkZXZEZWZhdWx0cztcbiAgICAgICAgfVxuICAgIH1cbn0iXX0=