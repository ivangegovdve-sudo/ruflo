#!/usr/bin/env node
/**
 * CI-friendly endpoint smoke test for RuFlo v3.1 roadmap endpoints.
 * 
 * Validates:
 *   1. GET /api/roadmap/plan-preview
 *   2. GET /api/run-events
 *   3. GET /api/run-events/audit-snapshot
 * 
 * Usage:
 *   node endpoint-smoke-test.js
 *   node endpoint-smoke-test.js --port 3333
 *   node endpoint-smoke-test.js --json
 * 
 * Exit codes:
 *   0 - All tests passed
 *   1 - One or more tests failed
 *   2 - Server startup failed
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3333;
const SERVER_STARTUP_TIMEOUT = 10000;

const testResults = {
  timestamp: new Date().toISOString(),
  port: DEFAULT_PORT,
  endpoints: {},
  passed: 0,
  failed: 0,
  errors: []
};

/**
 * Parse command line arguments
 */
function parseArguments() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', short: 'p', default: String(DEFAULT_PORT) },
      json: { type: 'boolean', short: 'j', default: false },
      host: { type: 'string', short: 'h', default: 'localhost' },
      help: { type: 'boolean', short: '?', default: false }
    }
  });
  
  if (values.help) {
    console.log(`
CI-friendly endpoint smoke test for RuFlo v3.1 roadmap endpoints.

Usage:
  node endpoint-smoke-test.js [options]

Options:
  -p, --port <port>  Port to run server on (default: ${DEFAULT_PORT})
  -h, --host <host>  Host to connect to (default: localhost)
  -j, --json         Output results as JSON
  -?, --help         Show this help message

Exit codes:
  0 - All tests passed
  1 - One or more tests failed
  2 - Server startup failed
`);
    process.exit(0);
  }
  
  return {
    port: parseInt(values.port, 10),
    host: values.host,
    jsonOutput: values.json
  };
}

/**
 * Make an HTTP GET request and return parsed JSON response
 */
function httpGet(path, port, host = 'localhost') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port,
      path,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${e.message}. Data: ${data.slice(0, 200)}`));
        }
      });
    });
    
    req.on('error', (e) => reject(e));
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${path}`));
    });
    req.end();
  });
}

/**
 * Start the ruflo-ui server as a child process
 */
function startServer(port, cwd) {
  return new Promise((resolve, reject) => {
    const uiPath = join(cwd, '..', 'ruflo-ui.cjs');
    
    const child = spawn(process.execPath, [uiPath, '--port', String(port)], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let serverReady = false;
    let startupError = null;
    
    const startupTimer = setTimeout(() => {
      if (!serverReady) {
        startupError = new Error(`Server did not start within ${SERVER_STARTUP_TIMEOUT}ms`);
        child.kill('SIGTERM');
      }
    }, SERVER_STARTUP_TIMEOUT);
    
    child.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('RuFlo Control Surface') || output.includes(`localhost:${port}`)) {
        serverReady = true;
        clearTimeout(startupTimer);
        resolve(child);
      }
    });
    
    child.stderr.on('data', (data) => {
      console.error('[server stderr]', data.toString());
    });
    
    child.on('error', (e) => {
      clearTimeout(startupTimer);
      reject(new Error(`Failed to spawn server: ${e.message}`));
    });
    
    child.on('close', (code) => {
      if (!serverReady && startupError) {
        reject(startupError);
      } else if (!serverReady) {
        reject(new Error(`Server process exited with code ${code} before becoming ready`));
      }
    });
  });
}

/**
 * Validate plan-preview endpoint response structure
 */
function validatePlanPreviewResponse(data, endpointResult) {
  const errors = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Response should be an object');
    return { valid: false, errors };
  }
  
  if (!data.roadmap || typeof data.roadmap !== 'object') {
    errors.push('Missing or invalid "roadmap" object');
  } else {
    if (!data.roadmap.name) errors.push('roadmap.name is missing');
    if (!data.roadmap.version) errors.push('roadmap.version is missing');
  }
  
  if (!data.plan || typeof data.plan !== 'object') {
    errors.push('Missing or invalid "plan" object');
  } else {
    if (!Array.isArray(data.plan.commands)) {
      errors.push('plan.commands should be an array');
    }
    if (!data.plan.source) errors.push('plan.source is missing');
  }
  
  if (!data.governance || typeof data.governance !== 'object') {
    errors.push('Missing or invalid "governance" object');
  } else {
    if (!data.governance.gate) errors.push('governance.gate is missing');
    if (typeof data.governance.score !== 'number') {
      errors.push('governance.score should be a number');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate run-events endpoint response structure
 */
function validateRunEventsResponse(data, endpointResult) {
  const errors = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Response should be an object');
    return { valid: false, errors };
  }
  
  if (typeof data.total !== 'number') {
    errors.push('"total" should be a number');
  }
  
  if (typeof data.returned !== 'number') {
    errors.push('"returned" should be a number');
  }
  
  if (!Array.isArray(data.events)) {
    errors.push('"events" should be an array');
  } else if (data.events.length > 0) {
    const event = data.events[0];
    if (!event.type) errors.push('Event items should have "type" property');
    if (!event.timestamp) errors.push('Event items should have "timestamp" property');
  }
  
  if (!data.filters || typeof data.filters !== 'object') {
    errors.push('Missing or invalid "filters" object');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate audit-snapshot endpoint response structure
 */
function validateAuditSnapshotResponse(data, endpointResult) {
  const errors = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Response should be an object');
    return { valid: false, errors };
  }
  
  if (!data.generatedAt) {
    errors.push('"generatedAt" is missing');
  } else {
    const date = new Date(data.generatedAt);
    if (isNaN(date.getTime())) {
      errors.push('"generatedAt" should be a valid ISO date string');
    }
  }
  
  if (!data.roadmap || typeof data.roadmap !== 'object') {
    errors.push('Missing or invalid "roadmap" object');
  }
  
  if (!data.plan || typeof data.plan !== 'object') {
    errors.push('Missing or invalid "plan" object');
  }
  
  if (!data.governance || typeof data.governance !== 'object') {
    errors.push('Missing or invalid "governance" object');
  }
  
  if (!data.runEvents || typeof data.runEvents !== 'object') {
    errors.push('Missing or invalid "runEvents" object');
  }
  
  if (!data.aggregates || typeof data.aggregates !== 'object') {
    errors.push('Missing or invalid "aggregates" object');
  } else {
    if (!data.aggregates.byType || typeof data.aggregates.byType !== 'object') {
      errors.push('aggregates.byType should be an object');
    }
    if (!data.aggregates.gateTotals || typeof data.aggregates.gateTotals !== 'object') {
      errors.push('aggregates.gateTotals should be an object');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Run tests for all endpoints
 */
async function runTests(port, host) {
  const endpoints = [
    {
      name: 'plan-preview',
      path: '/api/roadmap/plan-preview',
      validate: validatePlanPreviewResponse,
      description: 'Roadmap plan preview with governance'
    },
    {
      name: 'run-events',
      path: '/api/run-events?limit=50',
      validate: validateRunEventsResponse,
      description: 'Run events query'
    },
    {
      name: 'audit-snapshot',
      path: '/api/run-events/audit-snapshot?limit=100',
      validate: validateAuditSnapshotResponse,
      description: 'Run events audit snapshot'
    }
  ];
  
  for (const endpoint of endpoints) {
    const result = {
      name: endpoint.name,
      description: endpoint.description,
      path: endpoint.path,
      httpStatus: null,
      responseTime: null,
      validation: { valid: false, errors: [] },
      error: null
    };
    
    const startTime = Date.now();
    
    try {
      const response = await httpGet(endpoint.path, port, host);
      result.httpStatus = response.status;
      result.responseTime = Date.now() - startTime;
      
      if (response.status !== 200) {
        result.error = `HTTP status ${response.status}, expected 200`;
      } else {
        const validation = endpoint.validate(response.data, result);
        result.validation = validation;
        if (validation.valid) {
          testResults.passed++;
        } else {
          testResults.failed++;
          result.validation.errors.forEach(e => testResults.errors.push(`${endpoint.name}: ${e}`));
        }
      }
    } catch (e) {
      result.responseTime = Date.now() - startTime;
      result.error = e.message;
      testResults.failed++;
      testResults.errors.push(`${endpoint.name}: ${e.message}`);
    }
    
    testResults.endpoints[endpoint.name] = result;
  }
}

/**
 * Format test results for console output
 */
function formatConsoleOutput() {
  const lines = [];
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════════════╗');
  lines.push('║        RuFlo v3.1 Endpoint Smoke Test Results               ║');
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  lines.push(`║  Timestamp: ${testResults.timestamp.padEnd(41)}║`);
  lines.push(`║  Port:      ${String(testResults.port).padEnd(41)}║`);
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  
  for (const [name, result] of Object.entries(testResults.endpoints)) {
    const status = result.validation.valid && !result.error ? '✓ PASS' : '✗ FAIL';
    const statusColor = result.validation.valid && !result.error ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    
    lines.push(`║  ${statusColor}${status}${reset} ${name.padEnd(52)}║`);
    lines.push(`║    Path: ${result.path.substring(0, 48).padEnd(48)}║`);
    
    if (result.httpStatus) {
      lines.push(`║    HTTP: ${String(result.httpStatus).padEnd(52)}║`);
    }
    if (result.responseTime !== null) {
      lines.push(`║    Time: ${String(result.responseTime + 'ms').padEnd(52)}║`);
    }
    
    if (result.error) {
      const errMsg = result.error.substring(0, 50);
      lines.push(`║    Error: ${errMsg.padEnd(49)}║`);
    }
    
    if (result.validation.errors && result.validation.errors.length > 0) {
      result.validation.errors.slice(0, 2).forEach(e => {
        const errMsg = e.substring(0, 50);
        lines.push(`║    - ${errMsg.padEnd(50)}║`);
      });
    }
    
    lines.push('║  ──────────────────────────────────────────────────────────║');
  }
  
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  const passFail = `Passed: ${testResults.passed}  Failed: ${testResults.failed}`;
  lines.push(`║  ${passFail.padEnd(62)}║`);
  lines.push('╚════════════════════════════════════════════════════════════════╝');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArguments();
  testResults.port = args.port;
  
  console.error(`[smoke-test] Starting RuFlo v3.1 endpoint smoke test...`);
  console.error(`[smoke-test] Target: http://${args.host}:${args.port}`);
  
  let serverProcess = null;
  
  try {
    // Try to start the server if running locally
    console.error(`[smoke-test] Attempting to start ruflo-ui server on port ${args.port}...`);
    serverProcess = await startServer(args.port, __dirname);
    console.error(`[smoke-test] Server started successfully (PID: ${serverProcess.pid})`);
  } catch (startupError) {
    console.error(`[smoke-test] Warning: Could not start server: ${startupError.message}`);
    console.error(`[smoke-test] If server is already running, tests will proceed against existing instance.`);
    console.error(`[smoke-test] Otherwise, please start the server manually and re-run this test.`);
    // Don't fail - the server might already be running
  }
  
  try {
    await runTests(args.port, args.host);
  } finally {
    if (serverProcess) {
      console.error(`[smoke-test] Shutting down server (PID: ${serverProcess.pid})...`);
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }
  }
  
  // Output results
  if (args.jsonOutput) {
    console.log(JSON.stringify(testResults, null, 2));
  } else {
    console.error(formatConsoleOutput());
    
    // Also output JSON to stderr for CI log capture
    console.error('[smoke-test] JSON output:', JSON.stringify(testResults, null, 2));
  }
  
  // Exit with appropriate code
  if (testResults.failed > 0) {
    console.error(`[smoke-test] FAILED: ${testResults.failed} test(s) failed`);
    process.exit(1);
  } else {
    console.error(`[smoke-test] SUCCESS: All ${testResults.passed} test(s) passed`);
    process.exit(0);
  }
}

// Run main
main().catch(e => {
  console.error('[smoke-test] Fatal error:', e.message);
  console.error(e.stack);
  process.exit(2);
});
