// The editor's shared state and the small types every part of it uses. One
// mutable object, owned by initRulesEditor and passed to each part (rail,
// sheets, bar, menu), so a part reads `state.model` and `state.selected`
// instead of holding its own copy that could go stale.
export const locKey = (l) => `${l.rule ?? ''}|${l.field ?? ''}|${l.variable ?? ''}|${l.condition ?? ''}|${l.action ?? ''}`;
export const resolveCatalog = (state) => typeof state.catalog === 'function' ? state.catalog() : state.catalog ?? null;
//# sourceMappingURL=state.js.map