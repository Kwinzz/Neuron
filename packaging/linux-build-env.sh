# Réglages de compilation pour les installations Linux (sourcé par packaging/arch/PKGBUILD et install.sh).
#
# Le profil release de Cargo.toml vise l'installateur Windows (LTO complet, 1 seule unité de compilation) : la
# compilation de Neuron et l'édition des liens prennent alors plusieurs minutes, pour un gain imperceptible (l'UI
# tourne dans WebKit). Ici : pas de LTO, compilation parallèle et incrémentale (une mise à jour ne recompile que ce
# qui a changé), et l'éditeur de liens mold s'il est installé.
# NEURON_FULL_OPT=1 garde le profil complet.

if [ "${NEURON_FULL_OPT:-0}" != 1 ]; then
  export CARGO_PROFILE_RELEASE_LTO=false
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
  export CARGO_PROFILE_RELEASE_INCREMENTAL=true
fi
if command -v mold >/dev/null 2>&1; then
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-fuse-ld=mold"
fi
export npm_config_audit=false npm_config_fund=false npm_config_prefer_offline=true

# `npm ci` empties node_modules and downloads everything again: only when package-lock.json (or the Node version)
# changed since the last build in this folder.
neuron_npm_ci() {
  local stamp=node_modules/.neuron-lock want
  want="$(sha256sum package-lock.json | cut -d' ' -f1) $(node -v)"
  if [ -d node_modules ] && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ]; then
    echo "npm: dependencies unchanged, npm ci skipped"
    return 0
  fi
  npm ci && printf '%s\n' "$want" >"$stamp"
}
