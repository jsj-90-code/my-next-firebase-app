"""Bounded ICMP timestamp discovery. Reads an explicit IPv4 list from stdin.

No subnet expansion, router-error counting, or production database access.
Requires CAP_NET_RAW (the agent invokes this helper through existing sudo).
"""
import ipaddress
import json
import secrets
import select
import socket
import struct
import sys
import time

MAX_TARGETS = 65535
PACKETS_PER_SECOND = 100


def checksum(data):
    if len(data) % 2:
        data += b'\0'
    total = sum(struct.unpack('!%dH' % (len(data) // 2), data))
    while total >> 16:
        total = (total & 65535) + (total >> 16)
    return (~total) & 65535


def validate_targets(values):
    if not isinstance(values, list) or len(values) > MAX_TARGETS:
        raise ValueError('Expected at most 65535 explicit IPv4 addresses')
    result = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            raise ValueError('IPv4 addresses must be strings')
        address = ipaddress.IPv4Address(value)
        if not address.is_global or address.is_multicast:
            raise ValueError('Only public unicast IPv4 targets are allowed')
        ip = str(address)
        if ip not in seen:
            seen.add(ip)
            result.append(ip)
    return result


def matching_reply(data, identifier, expected):
    if len(data) < 40 or data[0] >> 4 != 4 or data[9] != socket.IPPROTO_ICMP:
        return None
    offset = (data[0] & 15) * 4
    length = struct.unpack('!H', data[2:4])[0]
    if offset < 20 or length < offset + 20 or length > len(data):
        return None
    if struct.unpack('!H', data[6:8])[0] & 0x3fff:  # no fragmented replies
        return None
    payload = data[offset:length]
    kind, code, _, ident, sequence = struct.unpack('!BBHHH', payload[:8])
    if kind != 14 or code != 0 or ident != identifier or checksum(payload) != 0:
        return None
    source = socket.inet_ntoa(data[12:16])
    return source if source in expected and expected[source] == sequence else None


def probe(values):
    targets = validate_targets(values)
    if not targets:
        return {'aliveIps': [], 'targetCount': 0, 'sentCount': 0}
    identifier = secrets.randbelow(65535) + 1
    sequences = {ip: i for i, ip in enumerate(targets, 1)}
    sent = {}
    alive = set()
    sent_count = 0
    with socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP) as sock:
        sock.setblocking(False)

        def receive(timeout):
            ready, _, _ = select.select([sock], [], [], max(0, timeout))
            if not ready:
                return
            for _ in range(256):
                try:
                    packet = sock.recv(65535)
                except BlockingIOError:
                    break
                source = matching_reply(packet, identifier, sent)
                if source:
                    alive.add(source)

        for _ in range(2):  # retry only addresses that have not replied
            for ip in targets:
                if ip in alive:
                    continue
                packet = struct.pack('!BBHHHIII', 13, 0, 0, identifier, sequences[ip], 0, 0, 0)
                packet = packet[:2] + struct.pack('!H', checksum(packet)) + packet[4:]
                sent[ip] = sequences[ip]
                # A local send failure aborts this method; it is never a zero measurement.
                sock.sendto(packet, (ip, 0))
                sent_count += 1
                until = time.monotonic() + 1 / PACKETS_PER_SECOND
                while time.monotonic() < until:
                    receive(until - time.monotonic())
            until = time.monotonic() + 3
            while time.monotonic() < until:
                receive(until - time.monotonic())
    return {'aliveIps': sorted(alive), 'targetCount': len(targets), 'sentCount': sent_count}


if __name__ == '__main__':
    try:
        result = probe(json.load(sys.stdin))
        print(json.dumps(result), flush=True)
    except Exception as error:
        print('timestamp probe failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
