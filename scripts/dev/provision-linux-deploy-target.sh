#!/bin/bash
# One-time provisioning for a linux_host_native deploy target (plan task B8).
#
# Run ON the target as a user with sudo, BEFORE the service account is used:
#   sudo bash scripts/dev/provision-linux-deploy-target.sh [service_user]
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

SERVICE_USER="${1:-bimdeploy}"
say() { printf '\n== %s ==\n' "$*"; }

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
py_minor="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
apt-get install -y git curl ca-certificates "python${py_minor}-venv" python3-pip

say "verify ensurepip"
python3 -c 'import ensurepip' && echo "ensurepip OK"

say "docker engine"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.gpg
  install -m 0644 -o root -g root /tmp/docker.gpg /etc/apt/keyrings/docker.asc
  rm -f /tmp/docker.gpg
  printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(. /etc/os-release && echo "$VERSION_CODENAME")" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "docker already installed"
fi
usermod -aG docker "$SERVICE_USER"

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
- ufw: rules are staged separately; enabling the firewall changes the
  posture of a shared host and is an owner decision.
NOTE
