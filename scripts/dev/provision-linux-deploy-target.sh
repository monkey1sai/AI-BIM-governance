#!/bin/bash
# One-time provisioning for a linux_host_native deploy target (plan task B8).
#
# Run ON the target as a user with sudo, BEFORE the service account is used:
#   sudo bash scripts/dev/provision-linux-deploy-target.sh <owner-supplied-service-user>
#
# Idempotent: every step is safe to re-run. Decision D-21 keeps steady-state
# operation at zero sudo, so everything needing root happens here, once.
#
# Each package below is here because a real deployment failed without it, not
# because it seemed plausible:
#   python3-venv  - Debian/Ubuntu split ensurepip out of the stdlib, so
#                   `python3 -m venv` fails with "ensurepip is not available"
#                   (hit on the first successful-guard run of deploy.ps1)
#   git/curl      - zero-credential HTTPS clone of the public repo
#   powershell    - deploy.ps1 and the whole gate/lib layer are pwsh
#   docker        - the web plane runs in compose; the service account needs
#                   the docker group so steady state needs no sudo
#   nodejs        - coordinator and viewer builds
# The NVIDIA driver is deliberately NOT installed here: the correct package is
# per-GPU (`ubuntu-drivers devices` recommends it) and a wrong pin is worse than
# an explicit manual step.

set -euo pipefail

say() { printf '\n== %s ==\n' "$*"; }

if [ "${1:-}" = "--check" ]; then
  missing=0
  for command_name in git curl python3 pwsh node docker; do
    if command -v "$command_name" >/dev/null 2>&1; then
      printf '[ok] %s\n' "$command_name"
    else
      printf '[missing] %s\n' "$command_name" >&2
      missing=1
    fi
  done
  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' || {
    echo '[missing] Python 3.11+ is required' >&2
    missing=1
  }
  docker compose version >/dev/null 2>&1 || {
    echo '[missing] Docker Compose v2 plugin is required' >&2
    missing=1
  }
  exit "$missing"
fi

if [ "${1:-}" = "--dry-run" ]; then
  if [ "$#" -ne 2 ] || ! [[ "$2" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    echo "usage: bash $0 --dry-run <owner-supplied-service-user>" >&2
    exit 2
  fi
  printf '[dry-run] target kind: linux_host_native\n'
  printf '[dry-run] validated owner-supplied service-user syntax\n'
  printf '[dry-run] ensure service account and owner-only SSH directory\n'
  printf '[dry-run] install apt prerequisites and Python 3.11+ venv support\n'
  printf '[dry-run] configure Docker repository, engine, Compose v2, and group membership\n'
  printf '[dry-run] enable systemd user lingering\n'
  printf '[dry-run] install PowerShell and Node.js when absent\n'
  printf '[dry-run] persist nouveau blacklist and refresh initramfs when needed\n'
  printf '[dry-run] report versions and owner-only follow-up actions\n'
  exit 0
fi

if [ "$#" -ne 1 ] || ! [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "usage: sudo bash $0 <owner-supplied-service-user> | bash $0 --check | bash $0 --dry-run <owner-supplied-service-user>" >&2
  exit 2
fi
SERVICE_USER="$1"

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (sudo bash $0)" >&2
  exit 1
fi

say "service account: $SERVICE_USER"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$SERVICE_USER"
  echo "created $SERVICE_USER"
else
  echo "$SERVICE_USER already exists"
fi
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "/home/$SERVICE_USER/.ssh"

say "apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
# python3-venv provides ensurepip; the versioned package matches the default
# interpreter and is what `python3 -m venv` actually asks for.
apt-get install -y git curl ca-certificates python3 python3-pip
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else "Python 3.11+ is required; install a supported interpreter before provisioning")'
py_minor="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
apt-get install -y "python${py_minor}-venv"

say "verify ensurepip"
python3 -c 'import ensurepip' && echo "ensurepip OK"

say "docker engine"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.gpg
  install -m 0644 -o root -g root /tmp/docker.gpg /etc/apt/keyrings/docker.asc
  rm -f /tmp/docker.gpg
  printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(. /etc/os-release && echo "$VERSION_CODENAME")" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "docker + Compose v2 already installed"
fi
usermod -aG docker "$SERVICE_USER"

say "enable lingering for $SERVICE_USER"
# Without this, systemd stops user@<uid>.service when the account's last session
# ends and kills everything under it. pwsh comes from snap, so the host-native
# services live in a scope beneath that unit: an SSH-driven deploy reported all
# four services healthy and every one was gone minutes after the transport
# disconnected. setsid does not help - it changes the POSIX session, not the
# systemd cgroup. Measured both ways on the target before adding this.
loginctl enable-linger "$SERVICE_USER"
loginctl show-user "$SERVICE_USER" -p Linger

say "powershell + node (snap)"
command -v pwsh >/dev/null 2>&1 || snap install powershell --classic
command -v node >/dev/null 2>&1 || snap install node --classic --channel=20

say "nouveau blacklist persistence"
if ! grep -rq "blacklist nouveau" /etc/modprobe.d /lib/modprobe.d 2>/dev/null; then
  printf 'blacklist nouveau\noptions nouveau modeset=0\n' > /etc/modprobe.d/zz-blacklist-nouveau.conf
  update-initramfs -u
  echo "nouveau blacklisted (reboot or rmmod to take effect)"
else
  echo "nouveau already blacklisted"
fi

say "versions"
git --version; curl --version | head -1
python3 --version; pwsh --version; node --version
docker --version; docker compose version
id "$SERVICE_USER"

say "NOT done here (deliberate)"
cat <<'NOTE'
- NVIDIA driver: run `ubuntu-drivers devices` and install the RECOMMENDED
  *-open metapackage for this GPU. A hardcoded pin here would rot.
  If nouveau is loaded and holds the GPU, `rmmod nouveau` then
  `modprobe nvidia` avoids a reboot when nouveau's refcount is 0.
- Service-account SSH key: append the operator public key to
  ~SERVICE_USER/.ssh/authorized_keys (mode 600, owned by the service user).
- Private target inventory: the owner must create
  <runtime_data_root>/target.local.json outside the checkout, mode 600, using
  scripts/target.local.example.json only as a schema example. This script does
  not create, upload, print, or overwrite private topology.
- ufw: rules are staged separately; enabling the firewall changes the
  posture of a shared host and is an owner decision.
NOTE
