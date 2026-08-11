from __future__ import annotations

import hashlib
import hmac
import re
import secrets


_USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$")
_SCRYPT_N = 2**15
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LENGTH = 32


def validate_username(value: str) -> str:
    username = value.strip()
    if not _USERNAME.fullmatch(username):
        raise ValueError("Username must contain 3-64 letters, numbers, dots, hyphens, or underscores")
    return username


def validate_password(value: str) -> str:
    if not 12 <= len(value) <= 512:
        raise ValueError("Password must contain 12-512 characters")
    classes = sum(
        (
            any(character.islower() for character in value),
            any(character.isupper() for character in value),
            any(character.isdigit() for character in value),
            any(not character.isalnum() for character in value),
        )
    )
    if classes < 3:
        raise ValueError("Password must use at least three of lowercase, uppercase, numbers, and symbols")
    return value


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_LENGTH,
        maxmem=128 * 1024 * 1024,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, raw_n, raw_r, raw_p, salt_hex, expected_hex = encoded.split("$")
        if algorithm != "scrypt":
            return False
        expected = bytes.fromhex(expected_hex)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(raw_n),
            r=int(raw_r),
            p=int(raw_p),
            dklen=len(expected),
            maxmem=128 * 1024 * 1024,
        )
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(derived, expected)


def dummy_password_check(password: str) -> None:
    # Equalize the expensive part of a failed login when the user does not exist.
    hash_password(password[:512] or "invalid-password", b"\0" * 16)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
