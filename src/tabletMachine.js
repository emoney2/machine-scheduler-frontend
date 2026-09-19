import { MACHINE_META } from "./machineFloorUtils";

const STORAGE_KEY = "embroidery.tabletMachine";
export const TABLET_MACHINE_CHANGED = "embroidery-tablet-machine-changed";

export function getTabletMachineId() {
  try {
    const value = localStorage.getItem(STORAGE_KEY) || "";
    return MACHINE_META[value] ? value : "";
  } catch (_) {
    return "";
  }
}

export function setTabletMachineId(machineId) {
  if (!MACHINE_META[machineId]) throw new Error("Unknown machine");
  localStorage.setItem(STORAGE_KEY, machineId);
  window.dispatchEvent(
    new CustomEvent(TABLET_MACHINE_CHANGED, { detail: { machineId } })
  );
}
