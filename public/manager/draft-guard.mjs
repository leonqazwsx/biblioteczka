const snapshot = (value) => JSON.stringify(value);
export function createDraftGuard() {
  let initial = null;
  return {
    start(value) {
      initial = snapshot(value);
    },
    saved(value) {
      initial = snapshot(value);
    },
    isDirty(value) {
      return initial !== null && snapshot(value) !== initial;
    },
    canClose(value, confirm) {
      return (
        initial === null ||
        snapshot(value) === initial ||
        confirm('Odrzucić niezapisane zmiany książki?')
      );
    },
    reset() {
      initial = null;
    },
  };
}
