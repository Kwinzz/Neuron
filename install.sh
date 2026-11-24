#!/usr/bin/env bash
# Neuron — installation automatique sous Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash
#
# Déjà installé ? Le script propose : mettre à jour, réinstaller ou désinstaller.
# Sans question :  ... | bash -s -- --install | --update | --uninstall  [--yes]
#
# Arch (et dérivées) : paquet pacman construit avec makepkg (packaging/arch/PKGBUILD).
# Debian / Ubuntu : paquet .deb ; Fedora : paquet .rpm — construits avec Tauri depuis les sources.

set -euo pipefail

REPO_URL="https://github.com/Kwinzz/Neuron.git"
BRANCH="${NEURON_BRANCH:-main}"
SRC_DIR="${NEURON_SRC_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/neuron-src}"
NODE_MIN_MAJOR=20
NODE_MIN_MINOR=19

ACTION=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --install) ACTION=install ;;
    --update) ACTION=update ;;
    --reinstall) ACTION=reinstall ;;
    --uninstall) ACTION=uninstall ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help)
      sed -n '2,10p' "$0" 2>/dev/null || true
      exit 0
      ;;
    *)
      echo "Option inconnue : $arg" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------- affichage

if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi
step() { printf '\n%s==>%s %s%s%s\n' "$CYAN" "$RESET" "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2
  exit 1
}

# Le script est souvent lancé par `curl | bash` : les réponses se lisent sur le terminal, pas sur stdin.
TTY=""
if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
  TTY=/dev/tty
fi

# ask "Question" [défaut o|n] → 0 = oui
ask() {
  local question="$1" default="${2:-o}" answer hint
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  if [ -z "$TTY" ]; then [ "$default" = o ]; return; fi
  if [ "$default" = o ]; then hint="[O/n]"; else hint="[o/N]"; fi
  printf '%s?%s %s %s ' "$CYAN" "$RESET" "$question" "$hint" >"$TTY"
  read -r answer <"$TTY" || answer=""
  answer="${answer:-$default}"
  case "${answer,,}" in o | oui | y | yes) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- système

[ "$(uname -s)" = Linux ] || die "Ce script est pour Linux. Sous Windows, utilise l'installateur : https://github.com/Kwinzz/Neuron/releases/latest"
[ "${EUID:-$(id -u)}" -ne 0 ] || die "Lance ce script avec ton utilisateur normal, pas en root (sudo sera demandé quand il faut)."
command -v sudo >/dev/null 2>&1 || die "sudo est nécessaire pour installer les dépendances et le paquet."

FAMILY=""
if command -v pacman >/dev/null 2>&1; then
  FAMILY=arch
elif command -v apt-get >/dev/null 2>&1; then
  FAMILY=debian
elif command -v dnf >/dev/null 2>&1; then
  FAMILY=fedora
else
  die "Distribution non prise en charge (ni pacman, ni apt, ni dnf). Voir le README pour compiler à la main."
fi

installed_version() {
  case "$FAMILY" in
    arch) pacman -Q neuron 2>/dev/null | awk '{print $2}' ;;
    debian) dpkg-query -W -f='${Status} ${Version}\n' neuron 2>/dev/null | awk '/install ok installed/ {print $4}' ;;
    fedora) rpm -q --qf '%{VERSION}-%{RELEASE}\n' neuron 2>/dev/null | grep -v 'not installed' || true ;;
  esac
}

stop_running() {
  if pgrep -x neuron >/dev/null 2>&1; then
    warn "Neuron est en cours d'exécution."
    if ask "Le fermer maintenant ?" o; then
      pkill -x neuron || true
      sleep 1
    else
      die "Ferme Neuron puis relance le script."
    fi
  fi
}

# ---------------------------------------------------------------- dépendances

install_deps() {
  step "Dépendances de compilation"
  case "$FAMILY" in
    arch)
      local deps=(base-devel git rust nodejs npm webkit2gtk-4.1 gtk3 libayatana-appindicator openssl)
      if ! sudo pacman -S --needed --noconfirm "${deps[@]}"; then
        # Base de paquets locale périmée (le miroir n'a plus ces versions → 404). Sur Arch, la seule bonne
        # réponse est une mise à jour complète (-Syu), jamais -Sy seul (mise à jour partielle).
        warn "pacman n'a pas pu télécharger certains paquets : la liste des paquets du système n'est plus à jour."
        ask "Mettre à jour le système (sudo pacman -Syu) puis réessayer ?" o ||
          die "Lance « sudo pacman -Syu », puis relance ce script."
        sudo pacman -Syu --needed --noconfirm "${deps[@]}"
      fi
      ;;
    debian)
      sudo apt-get update
      sudo apt-get install -y build-essential curl wget file git pkg-config libssl-dev libxdo-dev \
        libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      ;;
    fedora)
      sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file git libappindicator-gtk3-devel \
        librsvg2-devel libxdo-devel gcc gcc-c++ make
      ;;
  esac
  [ "$FAMILY" = arch ] || ensure_rust
  ensure_node
}

ensure_rust() {
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
  if command -v cargo >/dev/null 2>&1; then return; fi
  warn "Rust n'est pas installé."
  ask "Installer Rust avec rustup (https://rustup.rs) ?" o || die "Rust est nécessaire pour compiler Neuron."
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
}

ensure_node() {
  if [ "$FAMILY" != arch ] && ! command -v node >/dev/null 2>&1; then
    case "$FAMILY" in
      debian) sudo apt-get install -y nodejs npm ;;
      fedora) sudo dnf install -y nodejs npm ;;
    esac
  fi
  command -v node >/dev/null 2>&1 || die "Node.js est introuvable."
  local version major minor
  version="$(node -p 'process.versions.node')"
  major="${version%%.*}"
  minor="$(echo "$version" | cut -d. -f2)"
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]; }; then
    die "Node.js $version est trop ancien (il faut $NODE_MIN_MAJOR.$NODE_MIN_MINOR ou plus récent). Installe une version récente (https://nodejs.org ou nvm) puis relance."
  fi
}

# ---------------------------------------------------------------- sources

fetch_sources() {
  step "Sources de Neuron"
  if [ -d "$SRC_DIR/.git" ]; then
    info "Mise à jour de $SRC_DIR"
    git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
    git -C "$SRC_DIR" clean -fdq -e node_modules -e src-tauri/target -e packaging/arch/src -e packaging/arch/pkg
  else
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi
  LATEST="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",/\1/p' "$SRC_DIR/src-tauri/tauri.conf.json" | head -n1)"
  ok "Version disponible : $LATEST"
}

# ---------------------------------------------------------------- build + installation

build_and_install() {
  step "Compilation (quelques minutes la première fois)"
  case "$FAMILY" in
    arch)
      (cd "$SRC_DIR/packaging/arch" && makepkg -sif --noconfirm)
      ;;
    debian | fedora)
      local bundle=deb
      [ "$FAMILY" = fedora ] && bundle=rpm
      (cd "$SRC_DIR" && npm ci && npm run tauri build -- --bundles "$bundle")
      local pkg
      pkg="$(ls -t "$SRC_DIR"/src-tauri/target/release/bundle/"$bundle"/*."$bundle" 2>/dev/null | head -n1)"
      [ -n "$pkg" ] || die "Paquet .$bundle introuvable après la compilation."
      step "Installation du paquet"
      if [ "$FAMILY" = debian ]; then
        sudo apt-get install -y "$pkg"
      else
        sudo dnf install -y "$pkg"
      fi
      ;;
  esac
  ok "Neuron $(installed_version) est installé. Lance-le depuis le menu des applications (ou : neuron)."
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    info "${DIM}Wayland : pour la demande rapide, lie « neuron --quick » à un raccourci de ton bureau.${RESET}"
  fi
}

do_install() {
  install_deps
  fetch_sources
  stop_running
  build_and_install
}

do_uninstall() {
  stop_running
  step "Désinstallation"
  case "$FAMILY" in
    arch) sudo pacman -R --noconfirm neuron ;;
    debian) sudo apt-get remove -y neuron ;;
    fedora) sudo dnf remove -y neuron ;;
  esac
  rm -f "$HOME/.config/autostart/Neuron.desktop" "$HOME/.config/autostart/neuron.desktop"
  ok "Neuron est désinstallé."

  local data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.neuron.app"
  if [ -d "$data" ] || [ -d "$HOME/.neuron" ]; then
    # Jamais par défaut, même avec --yes : la mémoire et l'historique des chats ne se récupèrent pas.
    local keep_yes=$ASSUME_YES
    ASSUME_YES=0
    if ask "Supprimer aussi tes données (chats, réglages : $data ; mémoire : ~/.neuron) ?" n; then
      rm -rf "$data" "$HOME/.neuron"
      ok "Données supprimées."
    else
      info "Données gardées (elles resserviront si tu réinstalles)."
    fi
    ASSUME_YES=$keep_yes
  fi
  if [ -d "$SRC_DIR" ] && ask "Supprimer aussi les sources et la compilation ($SRC_DIR) ?" o; then
    rm -rf "$SRC_DIR"
  fi
}

# ---------------------------------------------------------------- menu

printf '%sNeuron%s — installation Linux (%s)\n' "$BOLD" "$RESET" "$FAMILY"
CURRENT="$(installed_version || true)"

if [ -z "$ACTION" ]; then
  if [ -z "$CURRENT" ]; then
    ACTION=install
  elif [ -z "$TTY" ] || [ "$ASSUME_YES" = 1 ]; then
    ACTION=update
  else
    printf '\nNeuron %s est déjà installé. Que veux-tu faire ?\n' "$CURRENT"
    printf '  1) Mettre à jour (dernière version)\n  2) Réinstaller\n  3) Désinstaller\n  4) Annuler\n'
    printf '%s?%s Choix [1] : ' "$CYAN" "$RESET" >"$TTY"
    read -r choice <"$TTY" || choice=""
    case "${choice:-1}" in
      1) ACTION=update ;;
      2) ACTION=reinstall ;;
      3) ACTION=uninstall ;;
      *)
        info "Rien n'a été modifié."
        exit 0
        ;;
    esac
  fi
fi

case "$ACTION" in
  install)
    if [ -n "$CURRENT" ]; then
      warn "Neuron $CURRENT est déjà installé : mise à jour."
    fi
    do_install
    ;;
  update)
    if [ -n "$CURRENT" ]; then info "Version installée : $CURRENT"; fi
    do_install
    ;;
  reinstall)
    if [ -n "$CURRENT" ]; then
      stop_running
      step "Retrait de la version installée"
      case "$FAMILY" in
        arch) sudo pacman -R --noconfirm neuron ;;
        debian) sudo apt-get remove -y neuron ;;
        fedora) sudo dnf remove -y neuron ;;
      esac
    fi
    do_install
    ;;
  uninstall)
    [ -n "$CURRENT" ] || die "Neuron n'est pas installé."
    if ask "Désinstaller Neuron $CURRENT ?" o; then do_uninstall; else info "Rien n'a été modifié."; fi
    ;;
esac
