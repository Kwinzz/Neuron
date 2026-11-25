/**
 * Paired devices (remote control over local network): this device's hosting status,
 * paired clients & hosts, and nearby devices discovered via mDNS.
 */
import { create } from "zustand";
import type { AccessLevel } from "@/bindings/AccessLevel";
import type { NearbyDevice } from "@/bindings/NearbyDevice";
import type { PairingCode } from "@/bindings/PairingCode";
import type { RemoteDevices } from "@/bindings/RemoteDevices";
import type { RemoteStatus } from "@/bindings/RemoteStatus";
import { setConnectedHosts } from "@/lib/deviceRouting";
import { isTauri, remote } from "@/lib/ipc";
import { keepIfSame, sameValue } from "@/lib/sameValue";
import { useDashboard } from "@/stores/dashboard";
import { useNav } from "@/stores/nav";

interface DevicesState {
  status: RemoteStatus | null;
  devices: RemoteDevices | null;
  nearby: NearbyDevice[];
  loaded: boolean;
  load: () => Promise<void>;
  scanNearby: () => Promise<NearbyDevice[]>;
  setEnabled: (enabled: boolean) => Promise<RemoteStatus>;
  setDeviceName: (name: string) => Promise<RemoteStatus>;
  startPairing: () => Promise<PairingCode>;
  cancelPairing: () => Promise<void>;
  pair: (nodeId: string, code: string) => Promise<string>;
  setLevel: (nodeId: string, level: AccessLevel) => Promise<void>;
  revoke: (nodeId: string) => Promise<void>;
  forget: (nodeId: string) => Promise<void>;
}

let prevConnectedHosts: readonly string[] = [];
let loadSeq = 0;

export const useDevices = create<DevicesState>((set, get) => ({
  status: null,
  devices: null,
  nearby: [],
  loaded: false,

  load: async () => {
    if (!isTauri()) {
      set({ loaded: true });
      return;
    }
    const seq = ++loadSeq;
    const [status, devices] = await Promise.all([remote.status(), remote.devices()]);
    if (seq !== loadSeq) return;

    const prev = get();
    set({
      status: keepIfSame(prev.status, status),
      devices: keepIfSame(prev.devices, devices),
      loaded: true,
    });

    const nextConnected = devices.hosts
      .filter((host) => host.connected)
      .map((host) => host.nodeId)
      .sort();

    setConnectedHosts(nextConnected);
    if (!sameValue(prevConnectedHosts, nextConnected)) {
      prevConnectedHosts = nextConnected;
      void useNav.getState().load();
      void useDashboard.getState().load();
    }
  },

  scanNearby: async () => {
    if (!isTauri()) return [];
    const list = await remote.nearby();
    set((prev) => ({ nearby: keepIfSame(prev.nearby, list) }));
    return list;
  },

  setEnabled: async (enabled) => {
    const next = await remote.setEnabled(enabled);
    await get().load();
    return next;
  },

  setDeviceName: async (name) => {
    const next = await remote.setDeviceName(name);
    await get().load();
    return next;
  },

  startPairing: async () => {
    const code = await remote.startPairing();
    await get().load();
    return code;
  },

  cancelPairing: async () => {
    await remote.cancelPairing();
    await get().load();
  },

  pair: async (nodeId, code) => {
    const name = await remote.pair(nodeId, code);
    await get().load();
    return name;
  },

  setLevel: async (nodeId, level) => {
    await remote.setLevel(nodeId, level);
    await get().load();
  },

  revoke: async (nodeId) => {
    await remote.revoke(nodeId);
    await get().load();
  },

  forget: async (nodeId) => {
    await remote.forget(nodeId);
    await get().load();
  },
}));
