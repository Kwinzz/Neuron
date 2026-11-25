/**
 * Which device each chat / project lives on (merged view of every paired device). Plain module state, read by
 * `ipc.ts` to route a call and by the UI for device badges. Absent = this device. Chat and project ids are UUIDs:
 * no collision between devices.
 */

const threadDevice = new Map<string, string>();
const projectDevice = new Map<string, string>();
let hosts: readonly string[] = [];

/** Device of a chat (its node id), or null for this device. */
export function deviceOfThread(threadId: string): string | null {
  return threadDevice.get(threadId) ?? null;
}

/** Device of a project (its node id), or null for this device. */
export function deviceOfProject(projectId: string | null | undefined): string | null {
  return projectId ? (projectDevice.get(projectId) ?? null) : null;
}

export function rememberThread(device: string | null, threadId: string): void {
  if (device) threadDevice.set(threadId, device);
  else threadDevice.delete(threadId);
}

export function rememberProject(device: string | null, projectId: string): void {
  if (device) projectDevice.set(projectId, device);
  else projectDevice.delete(projectId);
}

/** Paired hosts connected right now: the lists are merged from these (set by the devices store). */
export function setConnectedHosts(ids: readonly string[]): void {
  hosts = ids;
}

export function connectedHosts(): readonly string[] {
  return hosts;
}
