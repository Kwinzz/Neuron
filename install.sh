#!/usr/bin/env bash
# Neuron — automatic install on Linux / installation automatique sous Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash
#
# Already installed? The script offers to update, reinstall or uninstall.
# Non-interactive:  ... | bash -s -- --install | --update | --reinstall | --uninstall  [--yes] [--lang en|fr]
#                   [--from-source]
#
# Installs the package built by GitHub for the last commit of main (pre-release `main-build`: pacman package on
# Arch x86_64, .deb on Debian / Ubuntu, .rpm on Fedora; x86_64 and aarch64), in a few seconds. Builds from source
# (packaging/arch/PKGBUILD, or Tauri for .deb / .rpm) when there is none for this machine, with --from-source or
# with NEURON_BRANCH. The language chosen here is Neuron's interface language at first launch
# (~/.config/neuron/language).

set -euo pipefail

REPO_URL="https://github.com/Kwinzz/Neuron.git"
# NEURON_BRANCH=<branch>: build another branch, for a test. Updates always come back to main.
BRANCH="${NEURON_BRANCH:-main}"
SRC_DIR="${NEURON_SRC_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/neuron-src}"
PREBUILT_URL="https://github.com/Kwinzz/Neuron/releases/download/main-build"
# commit=<installed commit> / method=prebuilt|source: read by `neuron update` (compared with main).
INSTALL_STATE="${XDG_CONFIG_HOME:-$HOME/.config}/neuron/install"
FROM_SOURCE="${NEURON_FROM_SOURCE:-0}"
if [ -n "${NEURON_BRANCH:-}" ] && [ "$NEURON_BRANCH" != main ]; then FROM_SOURCE=1; fi
NODE_MIN_MAJOR=20
NODE_MIN_MINOR=19

ACTION=""
ASSUME_YES=0
UI_LANG=""
expect_lang=0
for arg in "$@"; do
  if [ "$expect_lang" = 1 ]; then
    UI_LANG="$arg"
    expect_lang=0
    continue
  fi
  case "$arg" in
    --install) ACTION=install ;;
    --update) ACTION=update ;;
    --reinstall) ACTION=reinstall ;;
    --uninstall) ACTION=uninstall ;;
    -y | --yes) ASSUME_YES=1 ;;
    --from-source) FROM_SOURCE=1 ;;
    --lang) expect_lang=1 ;;
    --lang=*) UI_LANG="${arg#--lang=}" ;;
    -h | --help)
      sed -n '2,15p' "$0" 2>/dev/null || true
      exit 0
      ;;
    *)
      echo "Unknown option / option inconnue: $arg" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------- output

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

# Often run as `curl | bash`: answers are read from the terminal, not from stdin.
TTY=""
if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
  TTY=/dev/tty
fi

# ---------------------------------------------------------------- language

# Default: the language chosen at a previous install, else asked (interactive) with the system's as default.
LANG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/neuron/language"
if [ -z "$UI_LANG" ] && [ -r "$LANG_FILE" ]; then
  UI_LANG="$(head -n1 "$LANG_FILE")"
fi
sys_lang="${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"
case "${sys_lang,,}" in fr*) default_lang=fr ;; *) default_lang=en ;; esac
case "${UI_LANG,,}" in
  fr*) UI_LANG=fr ;;
  en*) UI_LANG=en ;;
  *)
    UI_LANG="$default_lang"
    if [ -n "$TTY" ] && [ "$ASSUME_YES" != 1 ]; then
      if [ "$default_lang" = fr ]; then def_choice=2; else def_choice=1; fi
      printf '%sNeuron%s — Language / Langue\n  1) English\n  2) Français\n%s?%s [%s] ' \
        "$BOLD" "$RESET" "$CYAN" "$RESET" "$def_choice" >"$TTY"
      read -r lang_choice <"$TTY" || lang_choice=""
      case "${lang_choice:-$def_choice}" in 2 | fr* | FR*) UI_LANG=fr ;; *) UI_LANG=en ;; esac
    fi
    ;;
esac

# m "Français" "English" → the message in the chosen language.
m() { if [ "$UI_LANG" = fr ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

# ask "Question" [default y|n] → 0 = yes
ask() {
  local question="$1" default="${2:-y}" answer hint
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  if [ -z "$TTY" ]; then [ "$default" = y ]; return; fi
  if [ "$default" = y ]; then hint="$(m "[O/n]" "[Y/n]")"; else hint="$(m "[o/N]" "[y/N]")"; fi
  printf '%s?%s %s %s ' "$CYAN" "$RESET" "$question" "$hint" >"$TTY"
  read -r answer <"$TTY" || answer=""
  case "${answer,,}" in
    "") [ "$default" = y ] ;;
    o | oui | y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

# Neuron's interface language at first launch (read by the app when it has no language setting yet).
save_language() {
  mkdir -p "$(dirname "$LANG_FILE")" && printf '%s\n' "$UI_LANG" >"$LANG_FILE"
}

# ---------------------------------------------------------------- system

[ "$(uname -s)" = Linux ] || die "$(m "Ce script est pour Linux. Sous Windows, utilise l'installateur : https://github.com/Kwinzz/Neuron/releases/latest" "This script is for Linux. On Windows, use the installer: https://github.com/Kwinzz/Neuron/releases/latest")"
[ "${EUID:-$(id -u)}" -ne 0 ] || die "$(m "Lance ce script avec ton utilisateur normal, pas en root (sudo sera demandé quand il faut)." "Run this script as your normal user, not as root (sudo is asked for when needed).")"
command -v sudo >/dev/null 2>&1 || die "$(m "sudo est nécessaire pour installer les dépendances et le paquet." "sudo is needed to install the dependencies and the package.")"

FAMILY=""
if command -v pacman >/dev/null 2>&1; then
  FAMILY=arch
elif command -v apt-get >/dev/null 2>&1; then
  FAMILY=debian
elif command -v dnf >/dev/null 2>&1; then
  FAMILY=fedora
else
  die "$(m "Distribution non prise en charge (ni pacman, ni apt, ni dnf). Voir le README pour compiler à la main." "Unsupported distribution (no pacman, apt or dnf). See the README to build it by hand.")"
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
    warn "$(m "Neuron est en cours d'exécution." "Neuron is running.")"
    if ask "$(m "Le fermer maintenant ?" "Close it now?")" y; then
      pkill -x neuron || true
      sleep 1
    else
      die "$(m "Ferme Neuron puis relance le script." "Close Neuron, then run the script again.")"
    fi
  fi
}

# ---------------------------------------------------------------- dependencies

install_deps() {
  step "$(m "Dépendances de compilation" "Build dependencies")"
  case "$FAMILY" in
    arch)
      local deps=(base-devel git rust nodejs npm mold webkit2gtk-4.1 gtk3 libayatana-appindicator openssl)
      if ! sudo pacman -S --needed --noconfirm "${deps[@]}"; then
        # Stale local package database (the mirror no longer has those versions → 404). On Arch the only right
        # answer is a full upgrade (-Syu), never -Sy alone (partial upgrade).
        warn "$(m "pacman n'a pas pu télécharger certains paquets : la liste des paquets du système n'est plus à jour." "pacman could not download some packages: the system's package list is out of date.")"
        ask "$(m "Mettre à jour le système (sudo pacman -Syu) puis réessayer ?" "Upgrade the system (sudo pacman -Syu) and try again?")" y ||
          die "$(m "Lance « sudo pacman -Syu », puis relance ce script." "Run \"sudo pacman -Syu\", then run this script again.")"
        sudo pacman -Syu --needed --noconfirm "${deps[@]}"
      fi
      ;;
    debian)
      sudo apt-get update
      sudo apt-get install -y build-essential curl wget file git pkg-config libssl-dev libxdo-dev mold \
        libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      ;;
    fedora)
      sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file git mold libappindicator-gtk3-devel \
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
  warn "$(m "Rust n'est pas installé." "Rust is not installed.")"
  ask "$(m "Installer Rust avec rustup (https://rustup.rs) ?" "Install Rust with rustup (https://rustup.rs)?")" y ||
    die "$(m "Rust est nécessaire pour compiler Neuron." "Rust is needed to build Neuron.")"
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
  command -v node >/dev/null 2>&1 || die "$(m "Node.js est introuvable." "Node.js not found.")"
  local version major minor
  version="$(node -p 'process.versions.node')"
  major="${version%%.*}"
  minor="$(echo "$version" | cut -d. -f2)"
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]; }; then
    die "$(m "Node.js $version est trop ancien (il faut $NODE_MIN_MAJOR.$NODE_MIN_MINOR ou plus récent). Installe une version récente (https://nodejs.org ou nvm) puis relance." "Node.js $version is too old ($NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer is needed). Install a recent version (https://nodejs.org or nvm), then run this script again.")"
  fi
}

# ---------------------------------------------------------------- sources

fetch_sources() {
  step "$(m "Sources de Neuron" "Neuron sources")"
  if [ -d "$SRC_DIR/.git" ]; then
    info "$(m "Mise à jour de $SRC_DIR (branche $BRANCH)" "Updating $SRC_DIR (branch $BRANCH)")"
    # Explicit refspec: a --depth 1 clone only tracks the branch it was cloned from.
    git -C "$SRC_DIR" fetch --depth 1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
    git -C "$SRC_DIR" clean -fdq -e node_modules -e src-tauri/target -e packaging/arch/src -e packaging/arch/pkg
  else
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi
  git -C "$SRC_DIR" config --unset neuron.branch || true
  LATEST="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",/\1/p' "$SRC_DIR/src-tauri/tauri.conf.json" | head -n1)"
  ok "$(m "Version disponible : $LATEST" "Available version: $LATEST")"
}

# ---------------------------------------------------------------- prebuilt package

record_install() {
  mkdir -p "$(dirname "$INSTALL_STATE")"
  printf 'commit=%s\nmethod=%s\n' "$1" "$2" >"$INSTALL_STATE"
}

# Name of the prebuilt package for this machine (nothing for a combination GitHub doesn't build).
prebuilt_asset() {
  local arch
  case "$(uname -m)" in
    x86_64 | amd64) arch=x86_64 ;;
    aarch64 | arm64) arch=aarch64 ;;
    *) return 1 ;;
  esac
  case "$FAMILY" in
    arch) [ "$arch" = x86_64 ] && echo "neuron-x86_64.pkg.tar.zst" ;;
    debian) echo "neuron-$arch.deb" ;;
    fedora) echo "neuron-$arch.rpm" ;;
  esac
}

# Downloads the prebuilt package of main into PREBUILT_FILE (PREBUILT_COMMIT, PREBUILT_VERSION). Fails quietly: the
# caller then builds from source.
PREBUILT_FILE="" PREBUILT_COMMIT="" PREBUILT_VERSION=""
fetch_prebuilt() {
  [ "$FROM_SOURCE" != 1 ] || return 1
  local asset tmp
  asset="$(prebuilt_asset)" || return 1
  [ -n "$asset" ] && command -v curl >/dev/null 2>&1 || return 1
  step "$(m "Version précompilée de main" "Prebuilt version of main")"
  tmp="$(mktemp -d)"
  chmod 755 "$tmp" # apt reads the .deb as its own user
  if ! curl -fsSL --retry 2 "$PREBUILT_URL/build-info.txt" -o "$tmp/build-info.txt"; then
    warn "$(m "Pas de version précompilée disponible : compilation depuis les sources." "No prebuilt version available: building from source.")"
    rm -rf "$tmp"
    return 1
  fi
  PREBUILT_COMMIT="$(sed -n 's/^commit=//p' "$tmp/build-info.txt")"
  PREBUILT_VERSION="$(sed -n 's/^version=//p' "$tmp/build-info.txt")"
  info "$(m "Téléchargement de Neuron $PREBUILT_VERSION (${PREBUILT_COMMIT:0:7})" "Downloading Neuron $PREBUILT_VERSION (${PREBUILT_COMMIT:0:7})")"
  if [ -z "$PREBUILT_COMMIT" ] || ! curl -fL --retry 2 --progress-bar "$PREBUILT_URL/$asset" -o "$tmp/$asset"; then
    warn "$(m "Téléchargement impossible : compilation depuis les sources." "Download failed: building from source.")"
    rm -rf "$tmp"
    return 1
  fi
  PREBUILT_FILE="$tmp/$asset"
}

# Installs a package file, its dependencies included; the same version is reinstalled (an update of main often
# keeps the version number).
install_package_file() {
  local file="$1"
  step "$(m "Installation du paquet" "Installing the package")"
  case "$FAMILY" in
    arch)
      if ! sudo pacman -U --noconfirm "$file"; then
        warn "$(m "pacman n'a pas pu installer les dépendances : la liste des paquets du système n'est plus à jour." "pacman could not install the dependencies: the system's package list is out of date.")"
        ask "$(m "Mettre à jour le système (sudo pacman -Syu) puis réessayer ?" "Upgrade the system (sudo pacman -Syu) and try again?")" y ||
          die "$(m "Lance « sudo pacman -Syu », puis relance ce script." "Run \"sudo pacman -Syu\", then run this script again.")"
        sudo pacman -Syu --noconfirm
        sudo pacman -U --noconfirm "$file"
      fi
      ;;
    debian)
      sudo apt-get update
      sudo apt-get install -y --reinstall --allow-downgrades "$file"
      ;;
    fedora)
      local current file_version
      current="$(installed_version)"
      file_version="$(rpm -qp --qf '%{VERSION}-%{RELEASE}' "$file" 2>/dev/null || true)"
      if [ -n "$current" ] && [ "$current" = "$file_version" ]; then
        sudo dnf reinstall -y "$file"
      else
        sudo dnf install -y "$file"
      fi
      ;;
  esac
}

install_prebuilt() {
  stop_running
  install_package_file "$PREBUILT_FILE"
  rm -rf "$(dirname "$PREBUILT_FILE")"
  record_install "$PREBUILT_COMMIT" prebuilt
}

# ---------------------------------------------------------------- build + install

build_and_install() {
  step "$(m "Compilation (quelques minutes la première fois)" "Building (a few minutes the first time)")"
  case "$FAMILY" in
    arch)
      (cd "$SRC_DIR/packaging/arch" && makepkg -sif --noconfirm)
      ;;
    debian | fedora)
      local bundle=deb
      [ "$FAMILY" = fedora ] && bundle=rpm
      (
        cd "$SRC_DIR"
        # shellcheck disable=SC1091
        . packaging/linux-build-env.sh
        neuron_npm_ci && npm run tauri build -- --bundles "$bundle"
      )
      local pkg
      pkg="$(ls -t "$SRC_DIR"/src-tauri/target/release/bundle/"$bundle"/*."$bundle" 2>/dev/null | head -n1)"
      [ -n "$pkg" ] || die "$(m "Paquet .$bundle introuvable après la compilation." ".$bundle package not found after the build.")"
      install_package_file "$pkg"
      ;;
  esac
  # Commit actually installed: `neuron update` compares it with the head of main.
  record_install "$(git -C "$SRC_DIR" rev-parse HEAD)" source
}

after_install() {
  ok "$(m "Neuron $(installed_version) est installé. Lance-le depuis le menu des applications (ou : neuron)." "Neuron $(installed_version) is installed. Start it from the applications menu (or: neuron).")"
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    info "${DIM}$(m "Wayland : pour la demande rapide, lie « neuron --quick » à un raccourci de ton bureau." "Wayland: for the quick prompt, bind \"neuron --quick\" to a shortcut of your desktop.")${RESET}"
  fi
  # `neuron service install` was used: the server restarts on the new version.
  if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/neuron.service" ]; then
    systemctl --user restart neuron.service >/dev/null 2>&1 &&
      ok "$(m "Service neuron redémarré sur la nouvelle version." "neuron service restarted on the new version.")"
    return 0
  fi
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    info "$(m "Pas de session graphique : pour piloter cette machine depuis Neuron sur ton PC :" "No graphical session: to control this machine from Neuron on your PC:")"
    info "  neuron service install            $(m "# tourne en arrière-plan, démarre avec la machine" "# runs in the background, starts with the machine")"
    info "  neuron remote enable --internet   $(m "# accessible depuis tes autres appareils" "# reachable from your other devices")"
    info "  neuron remote code                $(m "# code / invitation à saisir sur ton PC" "# code / invitation to enter on your PC")"
  fi
}

do_install() {
  save_language
  if fetch_prebuilt; then
    install_prebuilt
  else
    install_deps
    fetch_sources
    stop_running
    build_and_install
  fi
  after_install
}

do_uninstall() {
  local unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/neuron.service"
  if [ -f "$unit" ]; then
    systemctl --user disable --now neuron.service >/dev/null 2>&1 || true
    rm -f "$unit"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  stop_running
  step "$(m "Désinstallation" "Uninstalling")"
  case "$FAMILY" in
    arch) sudo pacman -R --noconfirm neuron ;;
    debian) sudo apt-get remove -y neuron ;;
    fedora) sudo dnf remove -y neuron ;;
  esac
  rm -f "$HOME/.config/autostart/Neuron.desktop" "$HOME/.config/autostart/neuron.desktop"
  rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/neuron"
  ok "$(m "Neuron est désinstallé." "Neuron is uninstalled.")"

  local data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.neuron.app"
  if [ -d "$data" ] || [ -d "$HOME/.neuron" ]; then
    # Never by default, even with --yes: memory and chat history can't be recovered.
    local keep_yes=$ASSUME_YES
    ASSUME_YES=0
    if ask "$(m "Supprimer aussi tes données (chats, réglages : $data ; mémoire : ~/.neuron) ?" "Also delete your data (chats, settings: $data; memory: ~/.neuron)?")" n; then
      rm -rf "$data" "$HOME/.neuron"
      ok "$(m "Données supprimées." "Data deleted.")"
    else
      info "$(m "Données gardées (elles resserviront si tu réinstalles)." "Data kept (it will be used again if you reinstall).")"
    fi
    ASSUME_YES=$keep_yes
  fi
  if [ -d "$SRC_DIR" ] && ask "$(m "Supprimer aussi les sources et la compilation ($SRC_DIR) ?" "Also delete the sources and build files ($SRC_DIR)?")" y; then
    rm -rf "$SRC_DIR"
  fi
}

remove_package() {
  stop_running
  step "$(m "Retrait de la version installée" "Removing the installed version")"
  case "$FAMILY" in
    arch) sudo pacman -R --noconfirm neuron ;;
    debian) sudo apt-get remove -y neuron ;;
    fedora) sudo dnf remove -y neuron ;;
  esac
}

# ---------------------------------------------------------------- menu

printf '%sNeuron%s — %s (%s)\n' "$BOLD" "$RESET" "$(m "installation Linux" "Linux install")" "$FAMILY"
CURRENT="$(installed_version || true)"

if [ -z "$ACTION" ]; then
  if [ -z "$CURRENT" ]; then
    ACTION=install
  elif [ -z "$TTY" ] || [ "$ASSUME_YES" = 1 ]; then
    ACTION=update
  else
    printf '\n%s\n' "$(m "Neuron $CURRENT est déjà installé. Que veux-tu faire ?" "Neuron $CURRENT is already installed. What do you want to do?")"
    printf '%s\n' "$(m "  1) Mettre à jour (dernière version)" "  1) Update (latest version)")" \
      "$(m "  2) Réinstaller" "  2) Reinstall")" "$(m "  3) Désinstaller" "  3) Uninstall")" "$(m "  4) Annuler" "  4) Cancel")"
    printf '%s?%s %s ' "$CYAN" "$RESET" "$(m "Choix [1] :" "Choice [1]:")" >"$TTY"
    read -r choice <"$TTY" || choice=""
    case "${choice:-1}" in
      1) ACTION=update ;;
      2) ACTION=reinstall ;;
      3) ACTION=uninstall ;;
      *)
        info "$(m "Rien n'a été modifié." "Nothing was changed.")"
        exit 0
        ;;
    esac
  fi
fi

case "$ACTION" in
  install)
    if [ -n "$CURRENT" ]; then
      warn "$(m "Neuron $CURRENT est déjà installé : mise à jour." "Neuron $CURRENT is already installed: updating.")"
    fi
    do_install
    ;;
  update)
    if [ -n "$CURRENT" ]; then info "$(m "Version installée : $CURRENT" "Installed version: $CURRENT")"; fi
    do_install
    ;;
  reinstall)
    if [ -n "$CURRENT" ]; then remove_package; fi
    do_install
    ;;
  uninstall)
    [ -n "$CURRENT" ] || die "$(m "Neuron n'est pas installé." "Neuron is not installed.")"
    if ask "$(m "Désinstaller Neuron $CURRENT ?" "Uninstall Neuron $CURRENT?")" y; then
      do_uninstall
    else
      info "$(m "Rien n'a été modifié." "Nothing was changed.")"
    fi
    ;;
esac
