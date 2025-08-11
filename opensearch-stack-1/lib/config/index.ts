import { Construct } from "constructs";
import { StackConfiguration, RawConfigDefaults } from "./types";
import { ConfigParser } from "./parser";
import * as devDefaults from "./dev.json";
import * as prodDefaults from "./prod.json";

export { StackConfiguration, ParsedOpenSearchConfig, ServiceLogConfig, LogConfig } from "./types";
export { ConfigValidator } from "./validator";

export class ConfigManager {
    static loadConfiguration(scope: Construct, stage: string): StackConfiguration {
        const defaults = this.getDefaultsForStage(stage);
        return ConfigParser.parse(scope, stage, defaults);
    }

    private static getDefaultsForStage(stage: string): RawConfigDefaults {
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