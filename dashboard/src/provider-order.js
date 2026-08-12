function enabledIds(settings) {
  return settings.providerOrder.filter((id) => settings.providers[id]?.enabled);
}

export function reorderEnabledProviders(settings, activeId, overId) {
  if (!settings || activeId === overId) return settings;
  const ordered = enabledIds(settings);
  const from = ordered.indexOf(activeId);
  const to = ordered.indexOf(overId);
  if (from < 0 || to < 0) return settings;

  const next = [...ordered];
  next.splice(to, 0, next.splice(from, 1)[0]);
  let cursor = 0;
  return {
    ...settings,
    providerOrder: settings.providerOrder.map((id) => (
      settings.providers[id]?.enabled ? next[cursor++] : id
    )),
  };
}

export function moveEnabledProvider(settings, id, direction) {
  const ordered = enabledIds(settings);
  const from = ordered.indexOf(id);
  const to = Math.max(0, Math.min(ordered.length - 1, from + direction));
  if (from < 0 || from === to) return settings;
  return reorderEnabledProviders(settings, id, ordered[to]);
}
