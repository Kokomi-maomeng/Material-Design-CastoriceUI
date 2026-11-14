"""POSIX permission checks for configuration and writable panel state."""
import os
import stat
from pathlib import Path


def _check(path: Path, uid: int, gid: int | None, mask: int, *, directory: bool) -> None:
    metadata = path.lstat()
    if not (stat.S_ISDIR if directory else stat.S_ISREG)(metadata.st_mode):
        raise ValueError("must be a real directory" if directory else "must be a regular file")
    if not directory and metadata.st_nlink != 1:
        raise ValueError("must not have additional hard links")
    if metadata.st_uid != uid or (gid is not None and metadata.st_gid != gid) or metadata.st_mode & mask:
        raise ValueError("unexpected ownership or mode")
    if set(os.listxattr(path, follow_symlinks=False)) & {"system.posix_acl_access", "system.posix_acl_default"}:
        raise ValueError("remove extended access/default ACLs")


def _under(path: Path, root: Path) -> None:
    if root not in path.parents or ".." in path.parts:
        raise ValueError("must be beneath the protected directory")
    for parent in root.parents:
        _check(parent, 0, None, 0o7022, directory=True)


def check_config(path: Path, gid: int) -> None:
    root = Path("/etc/castoriceui")
    _under(path, root)
    for parent in path.parents:
        if parent == root or root in parent.parents:
            _check(parent, 0, gid, 0o7027, directory=True)
    _check(path, 0, gid, 0o7137, directory=False)  # at most 0640


def check_state(path: Path, uid: int, gid: int, *, directory: bool = False, optional: bool = False) -> None:
    root = Path("/var/lib/castoriceui")
    _under(path, root)
    try:
        # Walk top-down so a symlink is rejected before its children are read.
        for parent in reversed(path.parents):
            if parent == root or root in parent.parents:
                _check(parent, uid, gid, 0o7027, directory=True)
        if directory:
            _check(path, uid, gid, 0o7077, directory=True)
        else:
            _check(path, uid, gid, 0o7177, directory=False)  # at most 0600
    except FileNotFoundError:
        if not optional or not path.parent.is_dir():
            raise
