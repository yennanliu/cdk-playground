#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StockSummaryStack1Stack } from '../lib/stock-summary-stack-1-stack';

const app = new cdk.App();
new StockSummaryStack1Stack(app, 'StockSummaryStack1Stack-1');
