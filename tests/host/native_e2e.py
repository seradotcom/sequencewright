#!/usr/bin/env python3
"""CI-only: actual UI HTTP -> SQLite <- canonical Broker/Driver Host/Native SDK.
No mock provider or alternate authority. Fixtures contain synthetic project data.
"""
from __future__ import annotations
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = Path(os.environ.get('SEMWRIGHT_SOURCE', ROOT / 'upstream')).resolve()
BINS = UPSTREAM / 'target/debug'
EVIDENCE = ROOT / 'verification/host'
APP = 'sequencewright'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def request_digest(operation, expected, key, parameters):
    value = {'operation': operation, 'expected': expected, 'epoch': 1, 'key': key, 'parameters': parameters}
    data = 'sequencewright/request/1\n' + json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(data.encode()).hexdigest()


class OwnedFixture:
    def __init__(self):
        self.root = Path(os.environ['RUNNER_TEMP']) / ('sw-host-' + uuid.uuid4().hex[:12])
        self.root.mkdir(parents=True, mode=0o700)
        self.paths = {}
        for name in ['runtime', 'state', 'home', 'config', 'binary', 'data', 'bundle']:
            p = self.root / name
            p.mkdir(mode=0o700)
            self.paths[name] = p
        self.records = []
        self.daemon = None
        self.ui = None
        self.logs = []
        self.session = self.paths['runtime'] / 'session-1'
        self.socket = self.paths['runtime'] / 'broker.sock'
        assert len(os.fsencode(self.socket)) < 104, 'Owned Unix socket path must fit sockaddr_un'
        self.env = {k: v for k, v in os.environ.items() if k not in ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']}
        self.env.update(HOME=str(self.paths['home']), XDG_STATE_HOME=str(self.paths['state']), XDG_RUNTIME_DIR=str(self.paths['runtime']))
        node = self.paths['binary'] / 'node-runtime'
        shutil.copyfile(Path(shutil.which('node')).resolve(), node)
        node.chmod(0o500)
        driver = self.paths['binary'] / 'sequencewright-driver'
        shutil.copyfile(ROOT / 'native/target/debug/sequencewright-driver', driver)
        driver.chmod(0o500)
        bundle = self.paths['bundle'] / 'sequencewright.cjs'
        shutil.copyfile(ROOT / 'dist/sequencewright.cjs', bundle)
        bundle.chmod(0o400)
        self.node = node
        manifest = {
            'manifest_version': 1, 'protocol': 5, 'id': APP, 'version': '0.1.0',
            'publisher': 'sequencewright-owned-acceptance', 'executable': str(driver), 'sha256': digest(driver),
            'application': {'desktop_id': None, 'process_names': ['sequencewright-driver'], 'supported_versions': []},
            'transport': 'stdio_v1', 'network': False,
            'mounts': [{'root': 'native-runtime', 'read_only': True, 'execute': False}, {'root': 'sequencewright-data', 'read_only': False, 'execute': False}],
            'tools': [{'root': 'native-node', 'name': 'node', 'sha256': digest(node), 'mounts': ['sequencewright-data']}],
            'resources': {'open_files': 128, 'processes': 32, 'cpu_seconds': 120, 'operation_cpu_seconds': 0, 'address_space_bytes': 4294967296, 'file_size_bytes': 16777216},
            'request_timeout_ms': 10000,
            'interfaces': {'dynamic_capabilities': False, 'cooperative_cancellation': True, 'events': False, 'progress': False, 'artifacts': False, 'health': True, 'native_refs': True, 'host_tools': True},
        }
        manifest_path = self.paths['config'] / 'driver.json'
        manifest_path.write_text(json.dumps(manifest, indent=2))
        manifest_path.chmod(0o600)
        configuration = 'drivers = [' + json.dumps(str(manifest_path)) + ']\ndriver_network = false\n[policy]\nprofile = "observe"\nallow = ["driver:sequencewright"]\n'
        for name, path, writable in [('native-runtime', self.paths['bundle'], False), ('sequencewright-data', self.paths['data'], True), ('native-node', node, False)]:
            configuration += '\n[[policy.filesystem]]\nname = ' + json.dumps(name) + '\npath = ' + json.dumps(str(path)) + '\nread = true\nwrite = ' + str(writable).lower() + '\n'
        self.config = self.paths['config'] / 'owner.toml'
        self.config.write_text(configuration)
        self.config.chmod(0o600)
        (EVIDENCE / 'identities.json').write_text(json.dumps({'driver': digest(driver), 'bundle': digest(bundle), 'node': digest(node), 'sdk_source': subprocess.check_output(['git', '-C', str(UPSTREAM), 'rev-parse', 'HEAD'], text=True).strip(), 'application_source': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()}, indent=2))

    def start_ui(self):
        module = (ROOT / 'src/server.mjs').as_uri()
        script = 'import {createStudio} from ' + json.dumps(module) + '; const app=createStudio({root:process.argv[1],port:0});const port=await app.listen();console.log(JSON.stringify({port}));process.on("SIGTERM",()=>app.close().then(()=>process.exit(0)));'
        log = (EVIDENCE / 'ui-stderr.log').open('wb')
        self.logs.append(log)
        self.ui = subprocess.Popen([str(self.node), '--input-type=module', '-e', script, str(self.paths['data'])], env=self.env, stdout=subprocess.PIPE, stderr=log, text=True)
        selector = selectors.DefaultSelector()
        selector.register(self.ui.stdout, selectors.EVENT_READ)
        if not selector.select(12):
            raise AssertionError('Application UI failed to start within the bounded deadline')
        self.base = 'http://127.0.0.1:' + str(json.loads(self.ui.stdout.readline())['port'])
        selector.close()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = json.load(self.http.open(self.base + '/api/session', timeout=10))['csrf']

    def ui_call(self, operation, parameters=None, expected=None):
        body = json.dumps({'operation': operation, 'parameters': parameters or {}, 'expected': expected, 'key': uuid.uuid4().hex}).encode()
        request = urllib.request.Request(self.base + '/api/call', data=body, headers={'Content-Type': 'application/json', 'x-sequencewright-csrf': self.csrf})
        value = json.load(self.http.open(request, timeout=10))
        self.records.append({'transport': 'ui-http', 'operation': operation, 'response': value})
        assert value['ok'], value
        return value['data']

    def start_daemon(self, label):
        log = (EVIDENCE / f'daemon-{label}.log').open('wb')
        self.logs.append(log)
        self.daemon = subprocess.Popen([str(BINS / 'semwrightd'), '--config', str(self.config), '--socket', str(self.socket)], env=self.env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if self.daemon.poll() is not None:
                raise AssertionError('Canonical daemon exited: ' + (EVIDENCE / f'daemon-{label}.log').read_text())
            if self.socket.is_socket():
                return
            time.sleep(0.05)
        raise AssertionError('Canonical daemon startup deadline exceeded')

    def invoke(self, suffix, args):
        command = 'driver.sequencewright.' + suffix
        result = subprocess.run([str(BINS / 'semwright'), '--socket', str(self.socket), '--session-file', str(self.session), '--json', 'execute', command, '--args-json', json.dumps(args, separators=(',', ':'))], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, text=True)
        assert len(result.stdout) <= 1048576, 'CLI output budget exceeded'
        try:
            value = json.loads(result.stdout)
        except ValueError:
            raise AssertionError(result.stderr + result.stdout[:2000])
        self.records.append({'transport': 'canonical-cli', 'command': command, 'arguments': args, 'envelope': value, 'exit_code': result.returncode})
        assert result.returncode == 0 and value.get('ok'), value
        provenance = value['execution']['provenance']
        assert provenance['provider'] == 'driver:sequencewright' and provenance['source'] == 'driver', provenance
        assert provenance['descriptor_sha256'] and provenance['provider_generation'] is not None
        return value['data']

    def observe(self):
        return self.invoke('observe', {'resource': 'demo-product@main', 'scope': 'document', 'limit': 1})

    def mutation(self, view, suffix, key, parameters):
        expected = view['page']['version']
        identity = {'resource': expected['resource'], 'epoch': 1, 'key': key, 'request_sha256': request_digest('driver.sequencewright.' + suffix, expected, key, parameters)}
        return {'ref': view['ref'], 'request': identity, 'parameters': parameters}

    def stop_daemon(self):
        if self.daemon is None:
            return
        self.daemon.terminate()
        try:
            code = self.daemon.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(self.daemon.pid, signal.SIGKILL)
            self.daemon.wait(timeout=5)
            raise AssertionError('Owned daemon exceeded shutdown deadline')
        self.daemon = None
        assert code == 0, f'Daemon shutdown failed: {code}'

    def close(self):
        try:
            self.stop_daemon()
        finally:
            if self.ui is not None:
                self.ui.terminate()
                try:
                    self.ui.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.ui.kill()
                    self.ui.wait(timeout=5)
            for log in self.logs:
                log.close()
            (EVIDENCE / 'calls.json').write_text(json.dumps(self.records, indent=2))


def run():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'This heavy integration runs only on disposable CI runners'
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    fixture = OwnedFixture()
    try:
        fixture.start_ui()
        fixture.start_daemon('initial')
        before = fixture.observe()
        original = before['page']['items'][0]
        assert original['id'] == 'demo-product'
        args = fixture.mutation(before, 'document.edit', 'native-title', {'title': 'Edited through canonical Driver Host'})
        receipt = fixture.invoke('document.edit', args)
        assert receipt['version']['revision'] != before['page']['version']['revision']
        ui = fixture.ui_call('document.read', {'resource': 'demo-product@main'})
        assert ui['document']['title'] == 'Edited through canonical Driver Host'
        assert ui['version'] == receipt['version']
        fixture.ui_call('scene.update', {'sceneId': 's-1', 'changes': {'name': 'Edited in the local UI'}}, ui['version'])
        current = fixture.observe()
        assert current['page']['items'][0]['scenes'][0]['name'] == 'Edited in the local UI'
        recovery = fixture.invoke('operation.get', {'ref': current['ref'], 'request': args['request']})
        assert recovery['record']['state'] == 'recorded'
        assert recovery['record']['result']['version'] == receipt['version']
        assert recovery['historical_only'] and not recovery['current_authority'] and not recovery['replay_allowed']
        state = current['page']['version']
        fixture.stop_daemon()
        fixture.session = fixture.paths['runtime'] / 'session-2'
        fixture.start_daemon('restarted')
        reopened = fixture.observe()
        assert reopened['page']['version'] == state
        assert reopened['ref'] != current['ref']
        assert reopened['page']['items'][0] == current['page']['items'][0]
        (EVIDENCE / 'result.json').write_text(json.dumps({'status': 'PASS', 'checks': ['real canonical provider provenance', 'Native SDK edit visible through UI HTTP', 'UI edit visible through isolated Driver Host', 'durable historical recovery without current authority', 'daemon restart preserves application identity and contents', 'Host references renewed after restart'], 'rendering': 'NOT_RUN', 'graph_admission': 'NOT_RUN', 'effects': 'NOT_RUN'}, indent=2))
    finally:
        fixture.close()


if __name__ == '__main__':
    run()
