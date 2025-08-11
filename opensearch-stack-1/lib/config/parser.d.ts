import { Construct } from "constructs";
import { RawConfigDefaults, StackConfiguration } from "./types";
export declare class ConfigParser {
    static parse(scope: Construct, stage: string, defaults: RawConfigDefaults): StackConfiguration;
    private static getContextForType;
    private static parseServices;
}
