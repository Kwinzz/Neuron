import type { Translation } from "../catalog";
import type fr from "../fr/common";

const common: Translation<typeof fr> = {
  cancel: "Cancel",
  close: "Close",
  save: "Save",
  delete: "Delete",
  edit: "Edit",
  copy: "Copy",
  copied: "Copied",
  retry: "Retry",
  back: "Back",
  next: "Next",
  open: "Open",
  add: "Add",
  remove: "Remove",
  confirm: "Confirm",
  loading: "Loading…",
  search: "Search",
  none: "None",
  yes: "Yes",
  no: "No",
  untitledChat: "Untitled chat",
  openFolder: "Open folder",
  openFolderFailed: "Couldn't open the folder",
  openLinkFailed: "Couldn't open the link",
  openFileFolder: "Open the folder of {path}",
  justNow: "just now",
  error: "Error",
};

export default common;
