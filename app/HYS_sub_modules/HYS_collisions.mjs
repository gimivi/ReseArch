// HYS_sub_modules/HYS_collisions.mjs
//
// Collider di HySpace: quali nodi delle stanze fanno da muro/pavimento. La fisica
// (muri, appoggio a terra, cadute) è generica e sta in TJS_sub_modules/TJS-walk.mjs.

import { TJS_collectVisibleMeshesByName } from "../TJS_sub_modules/TJS-walk.mjs";

/**
 * Ricostruisce hs.colliders (array NUOVO: TJS_walkGrounding se ne accorge) con le sole
 * mesh visibili delle stanze indicate — di norma C + U + D.
 *
 * @param {object} hs - stato del pannello
 * @param {object} HS_NAMES - nomi dei nodi ("Pareti", "Pedane", "Pav_Aperto", …)
 * @param {string[]} slotsToUse
 */
export function HYS_rebuildColliders(hs, HS_NAMES, slotsToUse = ["C", "U", "D"]) {
  const names = [
    HS_NAMES.Pedane, HS_NAMES.Pareti,
    HS_NAMES.Pav_Chiuso, HS_NAMES.Pav_Aperto,
    HS_NAMES.Sof_Chiuso, HS_NAMES.Sof_Aperto,
    HS_NAMES.Scale,
  ];
  const out = [];
  for (const k of slotsToUse) {
    TJS_collectVisibleMeshesByName(hs.roomSlots.get(k)?.group, names, out);
  }
  hs.colliders = out;
}
