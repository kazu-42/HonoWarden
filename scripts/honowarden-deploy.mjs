#!/usr/bin/env node

import process from 'node:process'

process.stderr.write(
  'REAL WORKER/VERSION/TRAFFIC WRITE STOP: deploy, dry-run, and automated recovery are disabled pending a separately reviewed execution boundary.\n',
)
process.exitCode = 1
