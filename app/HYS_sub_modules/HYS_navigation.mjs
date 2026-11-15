// HYS_sub_modules/HYS_navigation.mjs

/**
 * Swap “veloce” dei contenuti tra due slot:
 * - scambia children dei Group (ROOM_X)
 * - scambia metadata: modelRow, url, openUp, openDown
 *
 * @param {object} hs
 * @param {string} aKey
 * @param {string} bKey
 */
export function HYS_swapSlots(hs, aKey, bKey) {
  const a = hs.roomSlots.get(aKey);
  const b = hs.roomSlots.get(bKey);
  if (!a?.group || !b?.group) return;

  const aChildren = a.group.children.slice();
  const bChildren = b.group.children.slice();

  for (const ch of aChildren) a.group.remove(ch);
  for (const ch of bChildren) b.group.remove(ch);

  for (const ch of aChildren) b.group.add(ch);
  for (const ch of bChildren) a.group.add(ch);

  [a.modelRow, b.modelRow] = [b.modelRow, a.modelRow];
  [a.url, b.url] = [b.url, a.url];
  [a.openUp, b.openUp] = [b.openUp, a.openUp];
  [a.openDown, b.openDown] = [b.openDown, a.openDown];
  [a.ese_id, b.ese_id] = [b.ese_id, a.ese_id];
  [a.exe, b.exe] = [b.exe, a.exe];
}

/**
 * Sposta TUTTO il contenuto di uno slot in un altro (modello + pannelli
 * "Quadri" + metadata), lasciando lo slot sorgente vuoto. Lo slot
 * destinazione deve essere già stato svuotato dal caller.
 * È la "traslazione" della stanza: niente ricaricamento, niente clone.
 *
 * @param {object} hs
 * @param {string} fromKey
 * @param {string} toKey
 */
export function HYS_moveSlotContent(hs, fromKey, toKey) {
  const from = hs.roomSlots.get(fromKey);
  const to = hs.roomSlots.get(toKey);
  if (!from?.group || !to?.group) return;

  for (const ch of from.group.children.slice()) {
    from.group.remove(ch);
    to.group.add(ch);
  }

  to.modelRow = from.modelRow;
  to.url = from.url;
  to.openUp = !!from.openUp;
  to.openDown = !!from.openDown;
  to.ese_id = from.ese_id ?? null;
  to.exe = from.exe ?? null;

  from.modelRow = null;
  from.url = null;
  from.openUp = false;
  from.openDown = false;
  from.ese_id = null;
  from.exe = null;
}

/**
 * Check soglie orizzontali e verticali e chiama i callback di transizione.
 *
 * Convenzione: playerRoot.position = quota PIEDI.
 * Quota pancia = feet + playerHeight*0.5.
 *
 * @param {object} hs
 * @param {THREE.Object3D} playerRoot
 * @param {(dir:'L'|'R'|'F'|'B')=>void} onEnterHorizontal
 * @param {(dir:'U'|'D')=>void} onEnterVertical
 */
export function HYS_checkThresholds(hs, playerRoot, onEnterHorizontal, onEnterVertical) {
  const x = playerRoot.position.x;
  const z = playerRoot.position.z;

  if (x > 5)  return onEnterHorizontal("R");
  if (x < -5) return onEnterHorizontal("L");
  if (z < -5) return onEnterHorizontal("F");
  if (z > 5)  return onEnterHorizontal("B");

 
 // DEBUG verticale: stampa solo quando sei "vicino" alle soglie
  // (altrimenti logga ogni frame e diventi pazzo)
  // --- VERTICALE: soglia a metà livello (step=4 => metà = 2)
  // playerRoot.position.y è quota "occhi"
  const bellyY = playerRoot.position.y - (hs.playerHeight * 0.5);

  const levelStep = 4;          // distanza tra C e U/D
  const halfStep  = levelStep * 0.5;  // 2
  const eps = 0.15;

  if (bellyY >  halfStep + eps) return onEnterVertical("U");
  if (bellyY < -halfStep - eps) return onEnterVertical("D");

}
