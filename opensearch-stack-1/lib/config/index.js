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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVBLHFDQUF3QztBQUN4Qyx3REFBMEM7QUFDMUMsMERBQTRDO0FBRzVDLHlDQUE4QztBQUFyQyw0R0FBQSxlQUFlLE9BQUE7QUFFeEIsTUFBYSxhQUFhO0lBQ3RCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFnQixFQUFFLEtBQWE7UUFDcEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2pELE9BQU8scUJBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU8sTUFBTSxDQUFDLG1CQUFtQixDQUFDLEtBQWE7UUFDNUMsUUFBUSxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUMxQixLQUFLLEtBQUssQ0FBQztZQUNYLEtBQUssYUFBYTtnQkFDZCxPQUFPLFdBQVcsQ0FBQztZQUN2QixLQUFLLE1BQU0sQ0FBQztZQUNaLEtBQUssWUFBWTtnQkFDYixPQUFPLFlBQVksQ0FBQztZQUN4QjtnQkFDSSw4Q0FBOEM7Z0JBQzlDLE9BQU8sV0FBVyxDQUFDO1FBQzNCLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFuQkQsc0NBbUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFN0YWNrQ29uZmlndXJhdGlvbiwgUmF3Q29uZmlnRGVmYXVsdHMgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgQ29uZmlnUGFyc2VyIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgKiBhcyBkZXZEZWZhdWx0cyBmcm9tIFwiLi9kZXYuanNvblwiO1xuaW1wb3J0ICogYXMgcHJvZERlZmF1bHRzIGZyb20gXCIuL3Byb2QuanNvblwiO1xuXG5leHBvcnQgeyBTdGFja0NvbmZpZ3VyYXRpb24sIFBhcnNlZE9wZW5TZWFyY2hDb25maWcgfSBmcm9tIFwiLi90eXBlc1wiO1xuZXhwb3J0IHsgQ29uZmlnVmFsaWRhdG9yIH0gZnJvbSBcIi4vdmFsaWRhdG9yXCI7XG5cbmV4cG9ydCBjbGFzcyBDb25maWdNYW5hZ2VyIHtcbiAgICBzdGF0aWMgbG9hZENvbmZpZ3VyYXRpb24oc2NvcGU6IENvbnN0cnVjdCwgc3RhZ2U6IHN0cmluZyk6IFN0YWNrQ29uZmlndXJhdGlvbiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5nZXREZWZhdWx0c0ZvclN0YWdlKHN0YWdlKTtcbiAgICAgICAgcmV0dXJuIENvbmZpZ1BhcnNlci5wYXJzZShzY29wZSwgc3RhZ2UsIGRlZmF1bHRzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBnZXREZWZhdWx0c0ZvclN0YWdlKHN0YWdlOiBzdHJpbmcpOiBSYXdDb25maWdEZWZhdWx0cyB7XG4gICAgICAgIHN3aXRjaCAoc3RhZ2UudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgICAgY2FzZSAnZGV2JzpcbiAgICAgICAgICAgIGNhc2UgJ2RldmVsb3BtZW50JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gZGV2RGVmYXVsdHM7XG4gICAgICAgICAgICBjYXNlICdwcm9kJzpcbiAgICAgICAgICAgIGNhc2UgJ3Byb2R1Y3Rpb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBwcm9kRGVmYXVsdHM7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGRldiBkZWZhdWx0cyBmb3IgdW5rbm93biBzdGFnZXNcbiAgICAgICAgICAgICAgICByZXR1cm4gZGV2RGVmYXVsdHM7XG4gICAgICAgIH1cbiAgICB9XG59Il19