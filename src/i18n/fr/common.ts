import type { Message } from "../index";

/** Words shared by every screen. Owned by the lead: namespaces add their own keys elsewhere. */
const common = {
  cancel: "Annuler",
  close: "Fermer",
  save: "Enregistrer",
  delete: "Supprimer",
  edit: "Modifier",
  copy: "Copier",
  copied: "Copié",
  retry: "Réessayer",
  back: "Retour",
  next: "Suivant",
  open: "Ouvrir",
  add: "Ajouter",
  remove: "Retirer",
  confirm: "Confirmer",
  loading: "Chargement…",
  search: "Rechercher",
  none: "Aucun",
  yes: "Oui",
  no: "Non",
  untitledChat: "Chat sans titre",
  openFolder: "Ouvrir le dossier",
  openFolderFailed: "Dossier non ouvert",
  openLinkFailed: "Lien non ouvert",
  openFileFolder: "Ouvrir le dossier de {path}",
  justNow: "à l'instant",
  error: "Erreur",
} satisfies Record<string, Message>;

export default common;
