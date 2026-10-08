import socket
import struct
import unittest
from timestamp_probe import checksum, matching_reply, validate_targets


def reply(source='115.89.100.89', kind=14, ident=123, sequence=1):
    payload = struct.pack('!BBHHHIII', kind, 0, 0, ident, sequence, 0, 1, 1)
    payload = payload[:2] + struct.pack('!H', checksum(payload)) + payload[4:]
    header = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 40, 0, 0, 115, 1, 0,
                         socket.inet_aton(source), socket.inet_aton('10.0.0.2'))
    return header + payload


class TimestampTests(unittest.TestCase):
    def test_only_matching_target_reply_counts(self):
        expected = {'115.89.100.89': 1}
        self.assertEqual(matching_reply(reply(), 123, expected), '115.89.100.89')
        for packet in [reply(source='115.89.100.90'), reply(kind=3), reply(kind=0),
                       reply(ident=124), reply(sequence=2), reply()[:-1], b'',
                       reply()[:-1] + b'\xff']:
            self.assertIsNone(matching_reply(packet, 123, expected))

    def test_unrequested_and_unsent_are_not_counted(self):
        self.assertIsNone(matching_reply(reply(), 123, {}))

    def test_no_range_expansion_or_private_addresses(self):
        self.assertEqual(validate_targets(['115.89.100.89'] * 2), ['115.89.100.89'])
        for values in [['115.89.100.0/24'], ['115.89.100.1-140'], ['127.0.0.1'],
                       ['10.0.0.1'], ['169.254.169.254'], ['224.0.0.1'], ['::1'], [123], {}]:
            with self.assertRaises(ValueError):
                validate_targets(values)


if __name__ == '__main__':
    unittest.main()
