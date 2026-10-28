// Layout changes triggered from the UI. Each one ends in ctx.commit(), which
// records an undo step, refreshes the panels and saves the layout.
export function createActions(ctx) {
  const { items } = ctx;
  const fail = (message) => { ctx.toast(message); return false; };

  // Where a Library item dropped at x/z would land (its centre kept inside the
  // yard), facing the camera to the nearest quarter turn.
  function libraryFit(key, x, z) {
    const tpl = items.templates[key];
    if (!tpl) return null;
    const cam = ctx.camera.position;
    const quarter = Math.PI / 2;
    const r = Math.round(Math.atan2(cam.x - x, cam.z - z) / quarter) * quarter;
    return items.fit({ box: tpl.box, attached: null }, { p: [x, 0, z], r, s: [1, 1, 1] });
  }

  const actions = {
    // Out of the yard entirely; it can be added again from the Library.
    remove(item) {
      items.discard(item);
      ctx.commit();
    },

    // An item in the yard dragged from the panel to ground point x/z: a copy goes there.
    dropAt(item, x, z) {
      if (item.attached) return fail(`The ${item.label.toLowerCase()} is fixed to the ${item.attached} and can't be copied.`);
      const copy = items.createCopy(item);
      items.setTransform(copy, items.fit(copy, { ...item.t, p: [x, item.t.p[1], z] }));
      ctx.select(copy);
      ctx.commit();
      return true;
    },

    // Copy / paste / duplicate (⌘C, ⌘V, ⌘D): a new copy of `source` (which may
    // have been removed since it was copied) with the copied spot and colours.
    copyFrom(source, { t, colors }) {
      if (source.attached) return fail(`The ${source.label.toLowerCase()} is fixed to the ${source.attached} and can't be copied.`);
      const copy = items.createCopy(source);
      items.setColors(copy, colors);
      items.setTransform(copy, items.fit(copy, t));
      ctx.select(copy);
      ctx.commit();
      return copy;
    },

    // One of the yard's own items, picked from the All tab, at x/z: the
    // original comes back if it was removed, otherwise a copy is added. Items
    // fixed to a wall or the lawn only come back to their own spot.
    addOriginal(key, x, z) {
      const item = items.get(key);
      if (!item) return false;
      if (item.exists && item.placed) {
        if (item.attached) { ctx.select(item); return fail(`The ${item.label.toLowerCase()} is already in use.`); }
        return actions.dropAt(item, x, z);
      }
      item.exists = true;
      if (!item.attached) items.setTransform(item, items.fit(item, { ...item.t, p: [x, item.t.p[1], z] }));
      items.setPlaced(item, true);
      ctx.select(item);
      ctx.commit();
      return true;
    },

    // A new copy of a Library item at ground point x/z (loads its model first).
    async addFromLibrary(key, x, z) {
      if (!(await ctx.library.ensure(key))) return fail("That item couldn't be loaded.");
      const item = items.createInstance(key, libraryFit(key, x, z));
      ctx.select(item);
      ctx.commit();
      return true;
    },

    // Change a ground area's surface (see ground.js).
    setSurface(area, surfaceId) {
      if (area.surface === surfaceId) return;
      ctx.ground.setSurface(area, surfaceId);
      ctx.commit();
    },

    // Swatch colour for one recolourable material; null = the model's own colour.
    recolor(item, material, hex) {
      const colors = { ...item.colors };
      if (hex) colors[material] = hex;
      else delete colors[material];
      items.setColors(item, colors);
      ctx.commit();
    },

    // `mergeKey` folds a burst of arrow-key steps in a size box into one undo step.
    resize(item, scale, mergeKey) {
      items.setTransform(item, items.fit(item, { ...item.t, s: scale }));
      ctx.commit(mergeKey);
      return true;
    },

    turn(item, degrees) {
      items.setTransform(item, items.fit(item, { ...item.t, r: item.t.r + (degrees * Math.PI) / 180 }));
      ctx.commit("turn:" + item.id);
      return true;
    },

    resetYard() {
      ctx.applyLayout(ctx.initialLayout);
      ctx.select(null);
      ctx.commit();
      ctx.toast("Yard reset to the original. Undo brings your layout back.");
    },
  };
  actions.libraryFit = libraryFit;
  return actions;
}
