"""Read existing diagnostic evidence only; never start probes or write production data."""
import collections
import json
import pathlib
import subprocess
import time

base = pathlib.Path('/tmp/codex_pc_handoff_20261011_xlc0oc5o')
manifest = json.loads((base / 'manifest.json').read_text())
events = []
for name in ['classicPaired20261012', 'fiveTimed20261013', 'geekstarFocused20261014']:
    if name not in manifest['jobs']:
        continue
    spec = manifest['jobs'][name]
    completion = None
    evidence = collections.defaultdict(collections.Counter)
    names = {}
    for line in open(spec['logPath']):
        event = json.loads(line)
        if event.get('event') == 'complete':
            completion = event
        if name != 'classicPaired20261012' and event.get('event') == 'sample':
            for store in event['stores']:
                sid = store['id']
                names[sid] = store['name']
                ips = {r['ip'] for r in event['results'] if r['id'] == sid and r['status'] == 'connected'}
                evidence[sid].update(ips)
    if completion:
        events.append({'id': 'complete:' + name, 'type': 'observation-complete', 'job': name, 'at': completion['at']})
    for sid, counts in evidence.items():
        repeated = [ip for ip, n in counts.items() if n >= 2]
        if repeated:
            events.append({'id': 'candidate:' + sid, 'type': 'repeat-connection', 'name': names[sid], 'ips': repeated})

state_path = pathlib.Path('/home/opc/ping-diagnostics/missing-stores/state.json')
state = json.loads(state_path.read_text()) if state_path.exists() else {}
for sid, candidate in state.get('candidates', {}).items():
    if not any(e['id'] == 'candidate:' + sid for e in events):
        events.append({'id': 'candidate:' + sid, 'type': 'repeat-connection', **candidate})
if state.get('phase') == 'all-candidates-found':
    events.append({'id': 'complete:all-candidates', 'type': 'all-candidates-found'})
if state.get('phase') == 'new-port-batch-complete':
    events.append({'id': 'complete:' + state['batchId'], 'type': 'new-port-batch-complete',
                   'checkedPorts': state.get('portCount'), 'checks': state.get('cursor'),
                   'nextAction': 'Review this completed batch and continue with untested ports only.'})
service = subprocess.run(['systemctl', 'is-active', 'ping-missing-discovery.service'], capture_output=True, text=True).stdout.strip()
print(json.dumps({'at': time.time(), 'events': events, 'service': service, 'phase': state.get('phase'), 'utilizationVerified': False}, ensure_ascii=False))
