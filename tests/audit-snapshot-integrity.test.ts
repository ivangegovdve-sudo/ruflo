/**
 * Audit Snapshot Integrity Tests
 * 
 * Tests for validateAuditSnapshotIntegrity function and
 * /api/run-events/audit-snapshot endpoint integrity field.
 * 
 * Covers: expected keys validation, gate totals consistency,
 *         event type counts, and snapshot structure.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PORT = 9876;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = resolve(import.meta.dirname, '..');

let serverProcess;

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

function waitForServer(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(url, (res) => {
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Server did not start in time'));
        } else {
          setTimeout(check, 100);
        }
      });
    };
    check();
  });
}

describe('Audit Snapshot Integrity', () => {
  before(async () => {
    serverProcess = spawn(process.execPath, ['./ruflo-ui.cjs', '--port', String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(BASE_URL);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  describe('validateAuditSnapshotIntegrity (unit)', () => {
    // Test the validation logic directly by importing the validation function
    // Since it's embedded in ruflo-ui.cjs, we test via endpoint responses

    it('should include _integrity field in snapshot', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(response.body._integrity, 'Snapshot should have _integrity field');
    });

    it('should mark valid snapshots as valid', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(
        typeof response.body._integrity.valid === 'boolean',
        '_integrity.valid should be boolean'
      );
    });

    it('should have errors array in _integrity', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(
        Array.isArray(response.body._integrity.errors),
        '_integrity.errors should be an array'
      );
    });

    it('should have warnings array in _integrity', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(
        Array.isArray(response.body._integrity.warnings),
        '_integrity.warnings should be an array'
      );
    });

    it('should have checkedAt timestamp in _integrity', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(
        response.body._integrity.checkedAt,
        '_integrity.checkedAt should exist'
      );
      // Should be ISO timestamp format
      const date = new Date(response.body._integrity.checkedAt);
      assert.ok(!isNaN(date.getTime()), 'checkedAt should be valid ISO timestamp');
    });

    it('should validate expected snapshot keys exist', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      const expectedKeys = ['generatedAt', 'roadmap', 'selectedItem', 'plan', 'governance', 'runEvents', 'aggregates'];
      for (const key of expectedKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(response.body, key),
          `Snapshot should have key: ${key}`
        );
      }
    });

    it('should validate runEvents structure', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      const expectedKeys = ['total', 'returned', 'filters', 'events'];
      for (const key of expectedKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(response.body.runEvents, key),
          `runEvents should have key: ${key}`
        );
      }
    });

    it('should validate aggregates.gateTotals structure', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      assert.ok(response.body.aggregates, 'aggregates should exist');
      assert.ok(response.body.aggregates.gateTotals, 'aggregates.gateTotals should exist');
      const gateTotals = response.body.aggregates.gateTotals;
      assert.strictEqual(typeof gateTotals.pass, 'number', 'gateTotals.pass should be number');
      assert.strictEqual(typeof gateTotals.warn, 'number', 'gateTotals.warn should be number');
      assert.strictEqual(typeof gateTotals.fail, 'number', 'gateTotals.fail should be number');
      assert.ok(gateTotals.pass >= 0, 'gateTotals.pass should be non-negative');
      assert.ok(gateTotals.warn >= 0, 'gateTotals.warn should be non-negative');
      assert.ok(gateTotals.fail >= 0, 'gateTotals.fail should be non-negative');
    });

    it('should validate gate totals sum consistency', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      
      const { gateTotals, byType } = response.body.aggregates;
      const calculatedSum = (gateTotals.pass || 0) + (gateTotals.warn || 0) + (gateTotals.fail || 0);
      
      // Count events with gate property
      const eventsWithGate = response.body.runEvents.events.filter(
        e => e && typeof e.gate === 'string' && e.gate.trim() !== ''
      );
      
      // If there are gate events, the sum should match
      if (eventsWithGate.length > 0) {
        assert.strictEqual(
          calculatedSum,
          eventsWithGate.length,
          `Gate totals sum (${calculatedSum}) should match events with gate (${eventsWithGate.length})`
        );
      }
      
      // Also verify byType consistency
      const eventTypeCounts = {};
      response.body.runEvents.events.forEach(e => {
        if (e && e.type) {
          eventTypeCounts[e.type] = (eventTypeCounts[e.type] || 0) + 1;
        }
      });
      
      for (const [type, count] of Object.entries(byType)) {
        assert.strictEqual(
          eventTypeCounts[type] || 0,
          count,
          `byType.${type} count (${count}) should match actual events (${eventTypeCounts[type] || 0})`
        );
      }
    });

    it('should pass integrity validation for well-formed snapshot', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot');
      assert.strictEqual(response.status, 200);
      
      // The snapshot should be valid (no errors)
      if (response.body._integrity.errors.length > 0) {
        console.log('Integrity errors:', response.body._integrity.errors);
      }
      assert.strictEqual(
        response.body._integrity.valid,
        true,
        'Snapshot should pass integrity validation'
      );
    });
  });

  describe('Audit Snapshot Download', () => {
    it('should include _integrity in downloaded snapshot', async () => {
      const response = await makeRequest('/api/run-events/audit-snapshot?download=1');
      assert.strictEqual(response.status, 200);
      assert.ok(
        response.body._integrity,
        'Downloaded snapshot should have _integrity field'
      );
    });
  });
});

describe('Audit Snapshot Integrity - Edge Cases', () => {
  let edgeServer;
  
  before(async () => {
    edgeServer = spawn(process.execPath, ['./ruflo-ui.cjs', '--port', String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(BASE_URL);
  });
  
  after(() => {
    if (edgeServer) {
      edgeServer.kill('SIGTERM');
    }
  });

  // Test with limit parameter
  it('should handle various limit values', async () => {
    const limits = [1, 10, 50, 100, 180];
    for (const limit of limits) {
      const response = await makeRequest(`/api/run-events/audit-snapshot?limit=${limit}`);
      assert.strictEqual(response.status, 200, `Failed for limit=${limit}`);
      assert.ok(response.body.runEvents, `Missing runEvents for limit=${limit}`);
      assert.ok(
        response.body.runEvents.returned <= limit,
        `returned (${response.body.runEvents.returned}) should be <= limit (${limit})`
      );
    }
  });

  it('should handle type filter parameter', async () => {
    const types = ['governance', 'governance-preview', 'run-blocked'];
    for (const type of types) {
      const response = await makeRequest(`/api/run-events/audit-snapshot?type=${type}`);
      assert.strictEqual(response.status, 200, `Failed for type=${type}`);
      assert.ok(response.body._integrity, `Missing integrity for type=${type}`);
    }
  });
});
