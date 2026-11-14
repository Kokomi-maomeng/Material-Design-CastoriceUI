"""Bounded DNS response validation for the UDP A-record probe (RFC 1035)."""
import struct


def _name(packet: bytes, offset: int, known: set[int]) -> tuple[tuple[bytes, ...], int]:
    next_offset = None
    visited: set[int] = set()
    labels: list[bytes] = []
    expanded = 1
    while True:
        if offset in visited or offset >= len(packet) or len(visited) >= 128:
            raise ValueError("Invalid DNS name")
        visited.add(offset)
        known.add(offset)
        length = packet[offset]
        if length & 0xC0 == 0xC0:
            if offset + 1 >= len(packet):
                raise ValueError("Incomplete DNS pointer")
            pointer = ((length & 0x3F) << 8) | packet[offset + 1]
            if pointer >= offset or pointer not in known:
                raise ValueError("Invalid DNS compression target")
            if next_offset is None:
                next_offset = offset + 2
            offset = pointer
        elif length == 0:
            return tuple(labels), offset + 1 if next_offset is None else next_offset
        else:
            expanded += length + 1
            if length > 63 or offset + 1 + length > len(packet) or expanded > 255:
                raise ValueError("Invalid DNS label")
            labels.append(packet[offset + 1:offset + 1 + length].lower())
            offset += length + 1


def verified_a_response(packet: bytes, query_id: int, query_name: str) -> bool:
    if not 12 <= len(packet) <= 4096:
        return False
    try:
        reply_id, flags, questions, answers, authority, additional = struct.unpack_from("!6H", packet)
        if reply_id != query_id or not flags & 0x8000 or flags & 0x7A4F or questions != 1 or not 1 <= answers or answers + authority + additional > 128:
            return False
        known: set[int] = set()
        name, offset = _name(packet, 12, known)
        if name != tuple(label.lower().encode("ascii") for label in query_name.split(".")) or struct.unpack_from("!HH", packet, offset) != (1, 1):
            return False
        offset += 4
        addresses: set[tuple[bytes, ...]] = set()
        aliases: dict[tuple[bytes, ...], tuple[bytes, ...]] = {}
        for index in range(answers + authority + additional):
            owner, offset = _name(packet, offset, known)
            rr_type, rr_class, _ttl, length = struct.unpack_from("!HHIH", packet, offset)
            offset += 10
            end = offset + length
            if end > len(packet) or not rr_type or not rr_class:
                return False
            if rr_type == 1 and rr_class == 1:
                if length != 4:
                    return False
                if index < answers:
                    addresses.add(owner)
            elif rr_type in {2, 5, 12, 39}:  # name-only RDATA (NS/CNAME/PTR/DNAME)
                target, consumed = _name(packet, offset, known)
                if consumed != end:
                    return False
                if rr_type == 5 and rr_class == 1 and index < answers:
                    if owner in aliases and aliases[owner] != target:
                        return False
                    aliases[owner] = target
            offset = end
        if offset != len(packet):
            return False
        seen = set()
        while name in aliases:
            if name in seen or name in addresses:
                return False
            seen.add(name)
            name = aliases[name]
        return name in addresses
    except (ValueError, struct.error):
        return False
