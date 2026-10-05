#!/usr/bin/env node
/**
 * Run or build the client against a self-hosted owpengram-server.
 *
 * The address (and optionally the server's RSA key) is written to .env.local,
 * which Vite loads after .env and git ignores -- so pointing a checkout at a
 * different server never shows up as a local modification, and nothing has to
 * be edited by hand. See src/config/owpengram.ts for what reads these.
 *
 *   node scripts/owpengram-web.mjs                      # ask, then run
 *   node scripts/owpengram-web.mjs run --server 1.2.3.4:2398
 *   node scripts/owpengram-web.mjs build --fetch-key
 *   node scripts/owpengram-web.mjs build --fast          # skip tests/typecheck
 *
 * One implementation rather than a .ps1/.sh pair: Node and pnpm are already
 * required to build this client at all, so this runs everywhere it does.
 */

import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {createPublicKey} from 'node:crypto';
import {connect} from 'node:net';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_LOCAL = join(ROOT, '.env.local');
const DEFAULT_SERVER = '127.0.0.1:2398';
const SERVER_KEY = 'VITE_OWPENGRAM_SERVER';
const MODULUS_KEY = 'VITE_OWPENGRAM_RSA_MODULUS';

function parseArgs(argv) {
  const options = {mode: '', server: '', fetchKey: false, fast: false};
  for(let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    switch(arg) {
      case 'run':
      case 'start':
        options.mode = 'run';
        break;
      case 'build':
        options.mode = 'build';
        break;
      case '--fetch-key':
        options.fetchKey = true;
        break;
      case '--fast':
        options.fast = true;
        break;
      case '--server':
        options.server = argv[++i] || '';
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if(arg.startsWith('--server=')) {
          options.server = arg.slice('--server='.length);
        } else {
          throw new Error(`unknown argument ${arg}`);
        }
    }
  }
  return options;
}

function usage() {
  console.log(`owpengram-web -- run or build the client against owpengram-server

Usage:
  node scripts/owpengram-web.mjs [run|build] [options]

Options:
  --server <host:port>  Server to talk to (default ${DEFAULT_SERVER}, asked when
                        not given and a terminal is attached).
  --fetch-key           Read the server's RSA public key from its
                        /owpengram/server-info endpoint and pin it in
                        .env.local. Needed when that server's key differs from
                        the one compiled into src/config/owpengram.ts.
  --fast                Build with vite only, skipping the tests, typecheck and
                        bundle check that \`pnpm run build\` also runs.
`);
}

/** Rewrites only our own keys, leaving anything else in .env.local alone. */
function writeEnvLocal(values) {
  const lines = existsSync(ENV_LOCAL) ?
    readFileSync(ENV_LOCAL, 'utf8').split(/\r?\n/) :
    [];

  // Trimmed BEFORE anything is appended, not after: the .env.local Vite copies
  // from the example is a single empty line and every written file ends in a
  // newline, so the blank those split into would otherwise end up in the
  // middle of the file as soon as a second key is added below it.
  while(lines.length && lines[0].trim() === '') lines.shift();
  while(lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  for(const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(key + '='));
    const entry = `${key}=${value}`;
    if(index === -1) {
      lines.push(entry);
    } else {
      lines[index] = entry;
    }
  }

  writeFileSync(ENV_LOCAL, lines.join('\n') + '\n');
}

/**
 * Derives the modulus the client needs from the PKCS#1 PEM the server serves.
 *
 * Trust-on-first-use over plain HTTP: fine for an operator deliberately
 * building against their own server, which is why this is opt-in rather than
 * something the client does at runtime (see src/config/owpengram.ts).
 */
async function fetchServerModulus(server) {
  const base = server.includes('://') ? server : 'http://' + server;
  const url = base.replace(/\/+$/, '') + '/owpengram/server-info';
  const response = await fetch(url);
  if(!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  const pem = (await response.json()).rsa_public_key_pem;
  if(!pem) {
    throw new Error(`${url} returned no rsa_public_key_pem`);
  }

  const jwk = createPublicKey(pem).export({format: 'jwk'});
  return Buffer.from(jwk.n, 'base64url').toString('hex');
}

/**
 * Checks the running Node against package.json's `engines.node`.
 *
 * Worth failing fast over, because the way pnpm reports this is close to
 * unreadable: an unsatisfied engine makes it consider node_modules invalid, so
 * before running ANY script it asks to delete and reinstall the whole thing --
 * and until that question is answered it prints nothing at all, so the dev
 * server just appears to hang.
 *
 * Only `^x.y.z` and `>=x.y.z` clauses separated by `||` are understood, which
 * is what this project declares; anything else is treated as satisfied rather
 * than pulling in a semver dependency for one check.
 */
function nodeSatisfies(range) {
  const current = process.versions.node.split('.').map(Number);
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

  return range.split('||').some((clause) => {
    const parsed = clause.trim().match(/^(\^|>=)?(\d+)\.(\d+)\.(\d+)$/);
    if(!parsed) {
      return true;
    }

    const wanted = [+parsed[2], +parsed[3], +parsed[4]];
    if(compare(current, wanted) < 0) {
      return false;
    }

    return parsed[1] === '^' ? current[0] === wanted[0] : true;
  });
}

const DEV_PORT = 8080;
const VITE_BIN = join('node_modules', 'vite', 'bin', 'vite.js');

/**
 * Whether something already accepts connections on the dev port, on either
 * address family -- Vite binds localhost, which Windows resolves to ::1.
 *
 * Worth checking up front, because the failure is silent otherwise: a second
 * `pnpm run start` waits behind the first and prints nothing, so it looks like
 * the dev server hangs while the first one is serving the page perfectly well.
 */
function isPortInUse(port) {
  const probe = (host) => new Promise((resolve) => {
    const socket = connect({host, port, timeout: 800});
    socket.on('connect', () => resolve(true));
    socket.on('timeout', () => resolve(false));
    socket.on('error', () => resolve(false));
    socket.once('close', () => socket.destroy());
  });

  return Promise.all([probe('::1'), probe('127.0.0.1')]).then((results) => results.some(Boolean));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    // One command string rather than an args array: a shell is needed at all
    // because pnpm is a .cmd shim on Windows that spawn cannot execute
    // directly, and passing args alongside shell: true is deprecated (DEP0190)
    // precisely because they would go through the shell unescaped. Everything
    // interpolated here is a literal from the call sites below.
    const child = spawn([command, ...args].join(' '), {cwd: ROOT, stdio: 'inherit', shell: true});
    child.on('error', reject);
    child.on('exit', (code) => {
      if(code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if(options.help) {
    usage();
    return;
  }

  // A warning, not a failure: the client builds and runs fine on an older Node,
  // the only real consequence is the prompt described here -- which is worth
  // predicting, because pnpm prints nothing at all while waiting for the answer
  // and the dev server simply appears to have hung.
  const required = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines?.node;
  if(required && !nodeSatisfies(required)) {
    console.log(`[!!] Node ${process.versions.node} is outside this project's engines ("${required}").`);
    console.log('     pnpm will ask to delete and reinstall node_modules before it runs anything,');
    console.log('     and shows nothing until that is answered -- answer Y, or install a newer Node');
    console.log('     to stop being asked every time.\n');
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let {mode, server} = options;

  if(!server) {
    server = process.env.VITE_OWPENGRAM_SERVER || '';
  }

  if(interactive && (!mode || !server)) {
    const rl = createInterface({input: process.stdin, output: process.stdout});
    try {
      if(!mode) {
        console.log('\n  What to do:');
        console.log('    [1] run   - dev server on :8080');
        console.log('    [2] build - production build into dist/\n');
        let answer = '';
        while(answer !== '1' && answer !== '2') {
          answer = (await rl.question('  Choice [1/2]: ')).trim();
        }
        mode = answer === '1' ? 'run' : 'build';
      }
      if(!server) {
        const answer = (await rl.question(`  owpengram-server address [${DEFAULT_SERVER}]: `)).trim();
        server = answer || DEFAULT_SERVER;
      }
    } finally {
      rl.close();
    }
  }

  mode ||= 'run';
  server ||= DEFAULT_SERVER;

  const values = {[SERVER_KEY]: server};
  if(options.fetchKey) {
    console.log(`[..] reading the server's RSA key from ${server}`);
    values[MODULUS_KEY] = await fetchServerModulus(server);
    console.log('[ok] key pinned in .env.local');
  }
  writeEnvLocal(values);
  console.log(`[ok] ${SERVER_KEY}=${server} (.env.local)`);

  if(!existsSync(join(ROOT, 'node_modules'))) {
    console.log('[..] installing dependencies');
    await run('pnpm', ['install']);
  }

  if(mode === 'run') {
    if(await isPortInUse(DEV_PORT)) {
      throw new Error(`something is already listening on port ${DEV_PORT} -- most likely a dev server from an earlier run, ` +
        `which is serving http://localhost:${DEV_PORT} right now. Open that, or stop it first (Ctrl+C in its terminal).`);
    }

    console.log('[..] starting the dev server -- open http://localhost:8080');
    console.log('     the server must allow that origin: TELESRV_WEBSOCKET_ALLOWED_ORIGINS\n');
    // Vite directly, not `pnpm run start` (which is just `vite`): pnpm first
    // switches to the version package.json pins, and that step can stall with
    // no output at all, so the dev server looks hung before it ever starts
    await run('node', [VITE_BIN]);
  } else if(options.fast) {
    console.log('[..] building with vite only (tests and typecheck skipped)\n');
    await run('node', [VITE_BIN, 'build']);
  } else {
    console.log('[..] building (tests, typecheck, then vite)\n');
    await run('pnpm', ['run', 'build']);
  }
}

main().catch((error) => {
  console.error('owpengram-web:', error.message);
  process.exit(1);
});
