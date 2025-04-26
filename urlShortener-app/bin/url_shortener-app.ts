#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { UrlShortenerAppStack } from '../lib/url_shortener-app-stack';

const app = new cdk.App();
new UrlShortenerAppStack(app, 'UrlShortenerAppStack');
