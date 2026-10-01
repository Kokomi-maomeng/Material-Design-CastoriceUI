#!/usr/bin/env python3
"""Boot an isolated official Debian cloud image and test panel installation/reboot."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path


def run(*args: str, check: bool = True, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("debian", choices=("12", "13"))
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="castorice-vm-") as directory:
        work = Path(directory)
        suite = "bookworm" if args.debian == "12" else "trixie"
        base = f"https://cloud.debian.org/images/cloud/{suite}/latest/"
        name = f"debian-{args.debian}-genericcloud-amd64.qcow2"
        with urllib.request.urlopen(base + "SHA512SUMS", timeout=30) as response:
            sums = response.read().decode()
        expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip("*") == name)
        image = work / name
        urllib.request.urlretrieve(base + name, image)
        digest = hashlib.sha512()
        with image.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError("Official Debian cloud image checksum mismatch")
        run("qemu-img", "resize", str(image), "8G")
        for key in ("client", "host"):
            run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "synthetic-ci", "-f", str(work / key))
        config = {"disable_root": False, "ssh_pwauth": False, "ssh_authorized_keys": [(work / "client.pub").read_text().strip()], "ssh_keys": {"ed25519_private": (work / "host").read_text(), "ed25519_public": (work / "host.pub").read_text().strip()}}
        (work / "user-data").write_text("#cloud-config\n" + json.dumps(config))
        (work / "meta-data").write_text("instance-id: castorice-ci\nlocal-hostname: castorice-ci\n")
        run("cloud-localds", str(work / "seed.iso"), str(work / "user-data"), str(work / "meta-data"))
        host_key = " ".join((work / "host.pub").read_text().split()[:2])
        (work / "known_hosts").write_text("[127.0.0.1]:22022 " + host_key + "\n")
        options = ["-i", str(work / "client"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={work / 'known_hosts'}"]
        ssh = ["ssh", "-p", "22022", *options, "root@127.0.0.1"]
        scp = ["scp", "-P", "22022", *options]
        acceleration = "kvm" if os.access("/dev/kvm", os.R_OK | os.W_OK) else "tcg"
        with (work / "console.log").open("w") as console:
            vm = subprocess.Popen(["qemu-system-x86_64", "-accel", acceleration, "-m", "1536", "-smp", "2", "-drive", f"file={image},if=virtio", "-drive", f"file={work / 'seed.iso'},format=raw,if=virtio", "-netdev", "user,id=n,hostfwd=tcp:127.0.0.1:22022-:22", "-device", "virtio-net-pci,netdev=n", "-nographic"], stdout=console, stderr=subprocess.STDOUT)
            def ready() -> None:
                for _ in range(180):
                    if vm.poll() is not None:
                        raise RuntimeError("QA VM exited during boot")
                    result = run(*ssh, "true", check=False, timeout=8)
                    if result.returncode == 0:
                        return
                    time.sleep(2)
                raise RuntimeError("QA VM did not become ready")
            try:
                ready()
                run(*ssh, "cloud-init status --wait", timeout=600)
                run(*ssh, "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-yaml nginx openssl iproute2 iputils-ping", timeout=900)
                run(*scp, str(args.archive.resolve()), str(root / "scripts/linux-install-acceptance.py"), "root@127.0.0.1:/root/")
                first = run(*ssh, f"python3 /root/linux-install-acceptance.py --archive /root/{args.archive.name} --phase install", timeout=900)
                print(first.stdout)
                boot_id = run(*ssh, "cat /proc/sys/kernel/random/boot_id").stdout.strip()
                run(*ssh, "systemctl reboot", check=False, timeout=10)
                time.sleep(5)
                ready()
                if run(*ssh, "cat /proc/sys/kernel/random/boot_id").stdout.strip() == boot_id:
                    raise RuntimeError("QA VM did not actually reboot")
                final = run(*ssh, f"python3 /root/linux-install-acceptance.py --archive /root/{args.archive.name} --phase reboot", timeout=900)
                print(final.stdout)
                print(json.dumps({"debian": args.debian, "officialImageChecksum": True, "actualVmReboot": True, "acceleration": acceleration}))
            except BaseException:
                print((work / "console.log").read_text(errors="replace")[-6000:])
                raise
            finally:
                vm.terminate()
                try:
                    vm.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    vm.kill(); vm.wait()


if __name__ == "__main__":
    main()
