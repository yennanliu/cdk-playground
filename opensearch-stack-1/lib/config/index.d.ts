import { Construct } from "constructs";
import { StackConfiguration } from "./types";
export { StackConfiguration, ParsedOpenSearchConfig } from "./types";
export { ConfigValidator } from "./validator";
export declare class ConfigManager {
    static loadConfiguration(scope: Construct, stage: string): StackConfiguration;
    private static getDefaultsForStage;
}
