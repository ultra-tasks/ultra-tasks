// This file is the default environment configuration for development
import pkg from '../../package.json';

export const environment = {
  production: false,
  stage: false,
  // Build-time switch: standalone web builds ship without any sync UI or engine.
  syncAvailable: true,
  version: pkg.version,
};
