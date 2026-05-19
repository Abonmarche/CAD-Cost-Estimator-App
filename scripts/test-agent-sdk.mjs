#!/usr/bin/env node
/*
 * Minimal Claude Agent SDK invocation — runs OUTSIDE the Electron app
 * and OUTSIDE our LLM proxy. Just imports the SDK from this repo's
 * node_modules and asks Claude one trivial question.
 *
 * Purpose: isolate whether the "claude-sonnet-X-Y may not exist or you
 * may not have access" error comes from:
 *   (a) the SDK + a real Anthropic key calling api.anthropic.com directly
 *       (likely a CLI bug or env-var issue), OR
 *   (b) something specific to our Electron app + proxy plumbing
 *       (env var override, MSAL token shape, header stripping, ...).
 *
 * If this script PASSES with a real Anthropic key:
 *   -> the SDK + CLI work fine; the bug is in our proxy chain.
 * If this script FAILS with the same error:
 *   -> the bug is in the SDK / CLI itself, regardless of our app.
 *
 * Usage (PowerShell):
 *   $env:ANTHROPIC_API_KEY = "sk-ant-..."     # required
 *   # OPTIONAL: also test through our proxy. Provide an MSAL access
 *   # token for the LLM API. (Skip these to call api.anthropic.com.)
 *   # $env:ANTHROPIC_BASE_URL = "https://func-cost-estimator-llm.azurewebsites.net"
 *   # The key should then be an MSAL JWT, not sk-ant-*
 *   node scripts/test-agent-sdk.mjs
 *
 * Pass --model <id> to override which model is requested.
 *
 * Prints every SDK message, captures stderr from the spawned subprocess,
 * and prints a verdict.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const MODEL = arg('model', 'claude-sonnet-4-5');
const PROMPT = arg('prompt', 'Say "hello" in one word and stop.');

const apiKey = process.env.ANTHROPIC_API_KEY;
const baseUrl = process.env.ANTHROPIC_BASE_URL;

if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY before running. Example:');
  console.error('  $env:ANTHROPIC_API_KEY = "sk-ant-..."');
  console.error('  node scripts/test-agent-sdk.mjs');
  process.exit(2);
}

// Same trick our agent.ts uses so the subprocess can load cli.js. The
// SDK runs from this repo's node_modules in dev, no asar in play.
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(
  here,
  '..',
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
  'cli.js',
);

console.log('--- agent SDK isolation test -----------------------------');
console.log('  model:                  ', MODEL);
console.log('  ANTHROPIC_API_KEY:       ', apiKey.slice(0, 10) + '...' + apiKey.slice(-4));
console.log('  ANTHROPIC_API_KEY type:  ', apiKey.startsWith('sk-ant-') ? 'Anthropic API key' : apiKey.startsWith('eyJ') ? 'JWT (MSAL token?)' : 'unknown');
console.log('  ANTHROPIC_BASE_URL:      ', baseUrl ?? '(unset — defaulting to api.anthropic.com)');
console.log('  pathToClaudeCodeExecutable:', cliPath);
console.log('  prompt:                  ', JSON.stringify(PROMPT));
console.log('----------------------------------------------------------');

const stderrBuf = [];

const opts = {
  pathToClaudeCodeExecutable: cliPath,
  model: MODEL,
  // No MCP servers, no tools, no system prompt — strip everything else
  // so we're testing only the model+auth+URL path.
  maxTurns: 1,
  // settingSources: [] is the SDK's default — don't load ~/.claude/settings.json
  // (would override env if a stale auth state lives there).
  settingSources: [],
  // Verbose so we get diagnostic lines on stderr from the CLI.
  debug: true,
  stderr: (data) => {
    process.stderr.write(`[cli-stderr] ${data}`);
    for (const line of String(data).split(/\r?\n/)) {
      if (line.trim()) stderrBuf.push(line);
    }
  },
  // The env the CLI subprocess gets. We pass through the parent env
  // (so PATH etc. work) and let ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
  // be what the user set in their shell.
  env: { ...process.env },
};

let finalResult = null;
let success = false;
let messageCount = 0;
let errorMessage = null;

try {
  for await (const msg of query({ prompt: PROMPT, options: opts })) {
    messageCount++;
    const tag = msg.type ?? 'unknown';
    console.log(`[msg ${messageCount}] type=${tag}`);
    if (msg.type === 'assistant') {
      const blocks = msg.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'text') {
          console.log(`    text: ${JSON.stringify(block.text)}`);
        } else if (block.type === 'tool_use') {
          console.log(`    tool_use: ${block.name}`);
        }
      }
    } else if (msg.type === 'result') {
      finalResult = msg;
      const r = msg;
      console.log(`    subtype: ${r.subtype}`);
      console.log(`    is_error: ${r.is_error}`);
      if (r.result) console.log(`    result: ${JSON.stringify(r.result).slice(0, 300)}`);
      if (!r.is_error) success = true;
    } else if (msg.type === 'system') {
      // initial system message includes session/model info
      const k = Object.keys(msg).filter((k) => k !== 'type');
      console.log(`    keys: ${k.join(', ')}`);
    }
  }
} catch (e) {
  errorMessage = e?.message ?? String(e);
  console.error(`\n[caught error] ${errorMessage}`);
}

console.log('\n--- verdict ----------------------------------------------');
console.log('  messages received:   ', messageCount);
console.log('  success:             ', success);
console.log('  final result type:   ', finalResult?.subtype ?? '(none)');
console.log('  caught exception:    ', errorMessage ?? '(none)');
console.log('  stderr lines captured:', stderrBuf.length);
if (stderrBuf.length > 0) {
  console.log('\n  last 15 stderr lines:');
  for (const line of stderrBuf.slice(-15)) {
    console.log('    ' + line);
  }
}
console.log('----------------------------------------------------------');

process.exit(success ? 0 : 1);
