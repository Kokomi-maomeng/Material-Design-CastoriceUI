"""Write the same root-owned, read-only-to-unprivileged tar on Windows/Linux."""
import pathlib
import sys
import tarfile

root, manifest, output, epoch = sys.argv[1:]
with tarfile.open(output, "w", format=tarfile.USTAR_FORMAT) as bundle:
    for name in pathlib.Path(manifest).read_text(encoding="utf-8").splitlines():
        source = pathlib.Path(root) / name
        entry = tarfile.TarInfo(name)
        entry.mtime = int(epoch)
        if source.is_symlink():
            raise ValueError("Release tar cannot contain symbolic links")
        if source.is_dir():
            entry.type, entry.mode = tarfile.DIRTYPE, 0o755
            bundle.addfile(entry)
        elif source.is_file():
            entry.mode = 0o755 if name.split("/", 1)[-1] == "deploy/install-or-upgrade.sh" else 0o644
            entry.size = source.stat().st_size
            with source.open("rb") as handle:
                bundle.addfile(entry, handle)
        else:
            raise ValueError("Release tar cannot contain special files")
